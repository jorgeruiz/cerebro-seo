/**
 * ReportPdf.tsx
 * Documento PDF del Reporte Mensual — renderizado con @react-pdf/renderer.
 * Solo se importa en la API route (servidor), nunca en el bundle del cliente.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { MonthlyReportResult } from "@/lib/monthly-report";

// ─── Estilos ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    backgroundColor: "#ffffff",
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 52,
    color: "#1a1a1a",
  },

  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  agencyLabel: {
    fontSize: 7,
    color: "#6b7280",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  clientName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    letterSpacing: -0.3,
  },
  domain: {
    fontSize: 7,
    color: "#9ca3af",
    marginTop: 2,
  },
  periodBox: {
    backgroundColor: "#f3f4f6",
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "flex-end",
  },
  periodLabel: {
    fontSize: 7,
    color: "#6b7280",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  periodValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },

  // Section
  sectionLabel: {
    fontSize: 7,
    color: "#9ca3af",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 18,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
    marginBottom: 8,
  },

  // Resumen ejecutivo
  summaryBox: {
    backgroundColor: "#f9fafb",
    borderRadius: 6,
    padding: 12,
    marginBottom: 4,
  },
  summaryText: {
    fontSize: 10,
    lineHeight: 1.6,
    color: "#374151",
  },

  // KPI grid
  kpiRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  kpiBox: {
    flex: 1,
    backgroundColor: "#f9fafb",
    borderRadius: 5,
    padding: 8,
    borderLeftWidth: 2,
    borderLeftColor: "#e5e7eb",
  },
  kpiLabel: {
    fontSize: 7,
    color: "#9ca3af",
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  kpiValue: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  kpiValueGreen: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#16a34a",
  },
  kpiValueRed: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#dc2626",
  },

  // Logros / Desafíos columns
  twoCol: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 4,
  },
  colBox: {
    flex: 1,
    borderRadius: 5,
    padding: 10,
  },
  colTitle: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: "row",
    gap: 5,
    marginBottom: 4,
  },
  bulletDot: {
    fontSize: 7,
    marginTop: 1,
  },
  bulletText: {
    flex: 1,
    fontSize: 8.5,
    lineHeight: 1.5,
    color: "#374151",
  },

  // Rankings table
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  tableTerm: {
    fontSize: 8,
    color: "#374151",
    maxWidth: "60%",
  },
  tableDelta: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },

  // Numbered list (plan)
  numberedRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 5,
  },
  numberedBadge: {
    width: 14,
    height: 14,
    backgroundColor: "#eff6ff",
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  numberedIndex: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#2563eb",
  },
  numberedText: {
    flex: 1,
    fontSize: 8.5,
    lineHeight: 1.5,
    color: "#374151",
  },

  // Oportunidades
  opBox: {
    backgroundColor: "#f9fafb",
    borderRadius: 5,
    padding: 10,
    marginBottom: 6,
  },
  opTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 3,
  },
  opDesc: {
    fontSize: 8,
    color: "#6b7280",
    lineHeight: 1.5,
    marginBottom: 4,
  },
  opAction: {
    fontSize: 8,
    color: "#374151",
    lineHeight: 1.5,
  },
  opBadgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  badge: {
    fontSize: 6.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 28,
    left: 52,
    right: 52,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 8,
  },
  footerText: {
    fontSize: 7,
    color: "#9ca3af",
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function impactoColors(impacto: string): { bg: string; color: string } {
  if (impacto === "alto") return { bg: "#fef2f2", color: "#dc2626" };
  if (impacto === "medio") return { bg: "#fffbeb", color: "#d97706" };
  return { bg: "#f3f4f6", color: "#6b7280" };
}

// ─── Documento PDF ────────────────────────────────────────────────────────────

interface ReportPdfProps {
  report: MonthlyReportResult;
  clientName: string;
  domain: string;
}

export function ReportPdf({ report, clientName, domain }: ReportPdfProps) {
  const kw = report.metricas.keywords;
  const bl = report.metricas.backlinks;
  const ai = report.metricas.aiSearch;
  const cy = report.metricas.ciclo;
  const generatedDate = new Date().toLocaleDateString("es-MX", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <Document
      title={`Reporte SEO ${report.periodo} — ${clientName}`}
      author="Click Society · Cerebro SEO"
      creator="Cerebro SEO"
    >
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.agencyLabel}>Click Society · Cerebro SEO</Text>
            <Text style={styles.clientName}>{clientName}</Text>
            <Text style={styles.domain}>{domain}</Text>
          </View>
          <View style={styles.periodBox}>
            <Text style={styles.periodLabel}>Período</Text>
            <Text style={styles.periodValue}>{report.periodo}</Text>
          </View>
        </View>

        {/* Resumen ejecutivo */}
        <Text style={styles.sectionLabel}>Resumen ejecutivo</Text>
        <View style={styles.divider} />
        <View style={styles.summaryBox}>
          <Text style={styles.summaryText}>{report.resumenEjecutivo}</Text>
        </View>

        {/* KPIs de keywords */}
        <Text style={styles.sectionLabel}>Rankings</Text>
        <View style={styles.divider} />
        <View style={styles.kpiRow}>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Total keywords</Text>
            <Text style={styles.kpiValue}>{kw.total}</Text>
          </View>
          <View style={[styles.kpiBox, { borderLeftColor: "#16a34a" }]}>
            <Text style={styles.kpiLabel}>Mejoraron</Text>
            <Text style={styles.kpiValueGreen}>{kw.mejoraron}</Text>
          </View>
          <View style={[styles.kpiBox, { borderLeftColor: kw.cayeron > 0 ? "#dc2626" : "#e5e7eb" }]}>
            <Text style={styles.kpiLabel}>Cayeron</Text>
            <Text style={kw.cayeron > 0 ? styles.kpiValueRed : styles.kpiValue}>{kw.cayeron}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Sin cambio</Text>
            <Text style={styles.kpiValue}>{kw.sinCambio}</Text>
          </View>
        </View>

        {/* Top mejoras y caídas */}
        {(kw.topMejoras.length > 0 || kw.topCaidas.length > 0) && (
          <View style={styles.twoCol}>
            {kw.topMejoras.length > 0 && (
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionLabel, { color: "#16a34a", marginTop: 8 }]}>Top mejoras</Text>
                {kw.topMejoras.map((m, i) => (
                  <View key={i} style={styles.tableRow}>
                    <Text style={styles.tableTerm}>{m.term}</Text>
                    <Text style={[styles.tableDelta, { color: "#16a34a" }]}>
                      {m.posicionAnterior} → {m.posicionActual}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {kw.topCaidas.length > 0 && (
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionLabel, { color: "#dc2626", marginTop: 8 }]}>Top caídas</Text>
                {kw.topCaidas.map((m, i) => (
                  <View key={i} style={styles.tableRow}>
                    <Text style={styles.tableTerm}>{m.term}</Text>
                    <Text style={[styles.tableDelta, { color: "#dc2626" }]}>
                      {m.posicionAnterior} → {m.posicionActual}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Otras métricas */}
        {(bl || ai || cy) && (
          <>
            <Text style={styles.sectionLabel}>Otras métricas</Text>
            <View style={styles.divider} />
            <View style={styles.kpiRow}>
              {bl && (
                <>
                  <View style={styles.kpiBox}>
                    <Text style={styles.kpiLabel}>Backlinks totales</Text>
                    <Text style={styles.kpiValue}>{bl.total}</Text>
                  </View>
                  <View style={styles.kpiBox}>
                    <Text style={styles.kpiLabel}>Dominios únicos</Text>
                    <Text style={styles.kpiValue}>{bl.dominiosUnicos}</Text>
                  </View>
                </>
              )}
              {ai && (
                <View style={styles.kpiBox}>
                  <Text style={styles.kpiLabel}>Mención Claude</Text>
                  <Text style={ai.tasaMencion >= 50 ? styles.kpiValueGreen : styles.kpiValue}>
                    {ai.tasaMencion}%
                  </Text>
                </View>
              )}
              {cy && (
                <View style={styles.kpiBox}>
                  <Text style={styles.kpiLabel}>Tareas completadas</Text>
                  <Text style={cy.tareasCompletadas === cy.tareasTotal ? styles.kpiValueGreen : styles.kpiValue}>
                    {cy.tareasCompletadas}/{cy.tareasTotal}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* Logros + Desafíos */}
        <Text style={styles.sectionLabel}>Balance del mes</Text>
        <View style={styles.divider} />
        <View style={styles.twoCol}>
          {/* Logros */}
          <View style={[styles.colBox, { backgroundColor: "#f0fdf4" }]}>
            <Text style={[styles.colTitle, { color: "#16a34a" }]}>Logros del mes</Text>
            {report.logros.map((logro, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={[styles.bulletDot, { color: "#16a34a" }]}>›</Text>
                <Text style={styles.bulletText}>{logro}</Text>
              </View>
            ))}
          </View>
          {/* Desafíos */}
          <View style={[styles.colBox, { backgroundColor: "#fffbeb" }]}>
            <Text style={[styles.colTitle, { color: "#d97706" }]}>Desafíos</Text>
            {report.desafios.map((desafio, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={[styles.bulletDot, { color: "#d97706" }]}>›</Text>
                <Text style={styles.bulletText}>{desafio}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Oportunidades */}
        {report.oportunidades?.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Oportunidades identificadas</Text>
            <View style={styles.divider} />
            {report.oportunidades.map((op, i) => {
              const colors = impactoColors(op.impacto);
              return (
                <View key={i} style={styles.opBox}>
                  <View style={styles.opBadgeRow}>
                    <Text style={styles.opTitle}>{op.titulo}</Text>
                    <Text style={[styles.badge, { backgroundColor: colors.bg, color: colors.color }]}>
                      {op.impacto}
                    </Text>
                  </View>
                  <Text style={styles.opDesc}>{op.descripcion}</Text>
                  <Text style={[styles.opAction, { color: "#2563eb" }]}>→ {op.accion}</Text>
                </View>
              );
            })}
          </>
        )}

        {/* Plan próximo mes */}
        {report.planProximoMes?.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Plan del próximo mes</Text>
            <View style={styles.divider} />
            {report.planProximoMes.map((accion, i) => (
              <View key={i} style={styles.numberedRow}>
                <View style={styles.numberedBadge}>
                  <Text style={styles.numberedIndex}>{i + 1}</Text>
                </View>
                <Text style={styles.numberedText}>{accion}</Text>
              </View>
            ))}
          </>
        )}

        {/* Conclusión */}
        {report.conclusionEjecutiva && (
          <>
            <Text style={styles.sectionLabel}>Conclusión estratégica</Text>
            <View style={styles.divider} />
            <View style={styles.summaryBox}>
              <Text style={styles.summaryText}>{report.conclusionEjecutiva}</Text>
            </View>
          </>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Click Society · Cerebro SEO · {generatedDate}
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Página ${pageNumber} de ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
