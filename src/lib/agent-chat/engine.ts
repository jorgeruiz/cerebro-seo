/**
 * Agent chat engine for Cerebro SEO.
 * Streams responses via SSE. Resolves tools between text chunks.
 * Runs in the web process (Messages API + fetch to Constructor, no Agent SDK).
 */

import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildSystemPrompt } from "./system-prompt";
import {
  getToolDefinitions,
  executeTool,
  type ToolContext,
} from "./tools";
import {
  AGENT_CHAT_MODEL,
  MAX_TURNS,
  MAX_TOKENS_CONVERSATION,
  MAX_OUTPUT_TOKENS,
} from "./config";

interface EngineOpts {
  conversationId: string;
  clientId: string;
  notionClientId: string;
  clientName: string;
  siteDomain: string | null;
  planId: string | null;
  userMessage: string;
}

export function handleAgentMessage(opts: EngineOpts): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        await runEngine(opts, controller, encoder);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error interno";
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });
}

async function runEngine(
  opts: EngineOpts,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
) {
  const {
    conversationId,
    clientId,
    notionClientId,
    clientName,
    siteDomain,
    planId,
    userMessage,
  } = opts;

  // Check token budget
  const conv = await prisma.agentConversation.findUnique({
    where: { id: conversationId },
    select: { tokensIn: true, tokensOut: true, status: true },
  });

  if (!conv || conv.status !== "OPEN") {
    emit(controller, encoder, "error", {
      error: "Conversacion no disponible.",
    });
    return;
  }

  if (conv.tokensIn + conv.tokensOut >= MAX_TOKENS_CONVERSATION) {
    emit(controller, encoder, "error", {
      error:
        "Limite de tokens alcanzado. Cierra esta conversacion y abre otra.",
    });
    return;
  }

  // Save user message
  await prisma.agentMessage.create({
    data: {
      conversationId,
      role: "USER",
      content: userMessage,
    },
  });

  // Load message history
  const history = await prisma.agentMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role === "USER" || m.role === "TOOL_RESULT" ? "user" : "assistant",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: m.content as any,
  }));

  // Build SEO context for system prompt
  let seoPlanSummary: string | null = null;
  let keywordsSummary: string | null = null;

  if (planId) {
    const plan = await prisma.monthlyPlan.findUnique({
      where: { id: planId },
      select: {
        month: true,
        status: true,
        summary: true,
        focus: true,
        tasks: {
          orderBy: { order: "asc" },
          take: 15,
          select: { title: true, status: true, actionType: true },
        },
      },
    });
    if (plan) {
      const taskLines = plan.tasks
        .map((t) => `- [${t.status}] ${t.title}${t.actionType ? ` (${t.actionType})` : ""}`)
        .join("\n");
      seoPlanSummary = `Mes: ${plan.month}\nEstado: ${plan.status}\n${plan.summary ? `Resumen: ${plan.summary}\n` : ""}Foco: ${plan.focus ?? "all"}\nTareas:\n${taskLines}`;
    }
  }

  const keywords = await prisma.keyword.findMany({
    where: { clientId, isPriority: true },
    take: 10,
    select: { term: true, category: true },
  });
  if (keywords.length > 0) {
    keywordsSummary = keywords
      .map((k) => `${k.term}${k.category ? ` [${k.category}]` : ""}`)
      .join(", ");
  }

  const systemText = buildSystemPrompt({
    clientName,
    siteDomain,
    seoPlanSummary,
    keywordsSummary,
  });

  const system: Anthropic.MessageCreateParams["system"] = [
    { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
  ];

  const tools = getToolDefinitions();

  const toolCtx: ToolContext = {
    notionClientId,
    clientId,
    clientName,
    conversationId,
    pendingSummary: null,
  };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let runTokensIn = 0;
  let runTokensOut = 0;
  let currentMessages = messages;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = client.messages.stream({
      model: AGENT_CHAT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: currentMessages as any,
      tools,
    });

    let assistantText = "";

    stream.on("text", (text) => {
      assistantText += text;
      emit(controller, encoder, "text", { text });
    });

    const finalMessage = await stream.finalMessage();
    runTokensIn += finalMessage.usage.input_tokens;
    runTokensOut += finalMessage.usage.output_tokens;

    const toolUseBlocks = finalMessage.content.filter(
      (b) => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0 || finalMessage.stop_reason !== "tool_use") {
      // Save final assistant message
      if (assistantText) {
        await prisma.agentMessage.create({
          data: {
            conversationId,
            role: "ASSISTANT",
            content: assistantText,
          },
        });
      }
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      if (block.type !== "tool_use") continue;
      const input = block.input as Record<string, unknown>;

      emit(controller, encoder, "tool_use", { name: block.name, input });
      const result = await executeTool(block.name, input, toolCtx);
      emit(controller, encoder, "tool_result", { name: block.name, result });

      // Save tool_use message
      await prisma.agentMessage.create({
        data: {
          conversationId,
          role: "TOOL_USE",
          content: { name: block.name, id: block.id, input } as unknown as Prisma.InputJsonValue,
        },
      });

      // Save tool_result message
      await prisma.agentMessage.create({
        data: {
          conversationId,
          role: "TOOL_RESULT",
          content: { tool_use_id: block.id, result } as unknown as Prisma.InputJsonValue,
        },
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result,
      });
    }

    // Save assistant message with full content (including tool_use blocks)
    await prisma.agentMessage.create({
      data: {
        conversationId,
        role: "ASSISTANT",
        content: finalMessage.content as unknown as Prisma.InputJsonValue,
      },
    });

    currentMessages = [
      ...currentMessages,
      { role: "assistant" as const, content: finalMessage.content },
      { role: "user" as const, content: toolResults },
    ];
  }

  // Update conversation token counts
  await prisma.agentConversation.update({
    where: { id: conversationId },
    data: {
      tokensIn: { increment: runTokensIn },
      tokensOut: { increment: runTokensOut },
    },
  });

  emit(controller, encoder, "done", {
    tokens_in: runTokensIn,
    tokens_out: runTokensOut,
  });
}

function emit(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown,
) {
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
}
