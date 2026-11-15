/**
 * Evaluador de las fórmulas de conversión de las definiciones (XDF/RomRaider).
 *
 * Una definición convierte el valor crudo de la ECU (X) en una magnitud
 * legible con una fórmula como "0.125 * X" o "(X-128)*0.75". Acá se evalúa
 * esa fórmula de forma acotada: solo números, la variable X y las cuatro
 * operaciones con paréntesis. Cualquier otro carácter se rechaza, así una
 * definición de la comunidad no puede ejecutar código arbitrario.
 */

export type Conversion = (x: number) => number;

const PERMITIDO = /^[0-9eE.+\-*/()\sxX]*$/;

/**
 * Compila una fórmula en una función. Si la fórmula no es segura o no es
 * válida, devuelve la identidad (X tal cual) para no romper la lectura.
 */
export function compilarFormula(equation: string): Conversion {
  const eq = equation.trim();
  if (eq === '' || eq.toUpperCase() === 'X') return (x) => x;
  if (!PERMITIDO.test(eq)) return (x) => x;
  try {
    // Solo se admite X como variable; el charset ya está validado.
    const fn = new Function('X', 'x', `"use strict"; return (${eq});`) as (X: number, x: number) => number;
    const prueba = fn(1, 1);
    if (!Number.isFinite(prueba)) return (x) => x;
    return (x) => {
      const r = fn(x, x);
      return Number.isFinite(r) ? r : x;
    };
  } catch {
    return (x) => x;
  }
}
