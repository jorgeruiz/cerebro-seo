import { describe, it, expect } from "vitest";
import { isTemplatePlaceholder } from "../memory-classifier";

describe("memory-classifier", () => {
  describe("isTemplatePlaceholder", () => {
    it("detects [NOMBRE DEL PROYECTO] as template", () => {
      expect(isTemplatePlaceholder("# [NOMBRE DEL PROYECTO]\n\nDescripción del proyecto [TODO]")).toBe(true);
    });

    it("detects {{ }} mustache as template", () => {
      expect(isTemplatePlaceholder("# Sitio\n\n{{ descripcion }}\n{{ url }}")).toBe(true);
    });

    it("detects PLACEHOLDER as template", () => {
      expect(isTemplatePlaceholder("# Site Spec\n\nPLACEHOLDER content here [INSERTAR descripción]")).toBe(true);
    });

    it("detects Lorem ipsum as template", () => {
      expect(isTemplatePlaceholder("# Sitio\n\nLorem ipsum dolor sit amet [TODO]")).toBe(true);
    });

    it("identifies real content as non-template", () => {
      const realContent = `# Molino Azteca

## Descripción
Molino Azteca es una empresa de harinas y productos de maíz con más de 50 años
de experiencia en Monterrey, México. Su sitio web presenta su catálogo de productos,
historia, y puntos de venta. El público objetivo son distribuidores y consumidores
finales en México.

## Stack
- Next.js 14 App Router
- TailwindCSS
- Vercel

## Dominio
molinoazteca.com.mx`;
      expect(isTemplatePlaceholder(realContent)).toBe(false);
    });

    it("identifies short content with single marker as template", () => {
      expect(isTemplatePlaceholder("# Sitio\n\n[TODO]")).toBe(true);
    });

    it("returns false for empty string (classified as ABSENT, not TEMPLATE)", () => {
      expect(isTemplatePlaceholder("")).toBe(false);
    });
  });
});
