/**
 * Layout del detalle de cliente — monta ClipboardProvider.
 *
 * - El provider se keyed por clientId: si el usuario navega entre clientes,
 *   React desmonta el provider anterior y monta uno nuevo → items se resetean.
 * - El layout persiste al navegar ENTRE módulos del mismo cliente (keyword-ideas,
 *   aeo-research, contenido, etc.) → los items del portapapeles se mantienen.
 */

import type { ReactNode } from "react";
import { ClipboardProvider } from "./ClipboardContext";

export default function ClientDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { id: string };
}) {
  return (
    // key={params.id} fuerza remount del provider al cambiar de cliente
    <ClipboardProvider key={params.id} clientId={params.id}>
      {children}
    </ClipboardProvider>
  );
}
