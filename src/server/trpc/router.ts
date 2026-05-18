import { router } from "./index";
import { clientesRouter } from "./routers/clientes";

export const appRouter = router({
  clientes: clientesRouter,
});

export type AppRouter = typeof appRouter;
