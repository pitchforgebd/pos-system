// Barcodes (P04 task 6, feature 11): the check digit and the bars of an EAN-13, a Code 39 fallback for codes that are not an EAN-13, and
// the shop's own EAN-13 numbers. The 200-299 range of EAN-13 is set aside for a shop's internal use, so a code made here never meets a
// manufacturer's.

/** The check digit of the first twelve digits of an EAN-13. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) {
    throw new RangeError("An EAN-13 starts from twelve digits.");
  }
  const sum = [...first12].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string) {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

// --- bars ---

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
// Which of the six left digits use the G set, by the first digit.
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

function ean13Modules(code: string) {
  const parity = PARITY[Number(code[0])];
  let modules = "101";
  for (let index = 0; index < 6; index += 1) {
    const digit = Number(code[index + 1]);
    modules += parity[index] === "L" ? L[digit] : G[digit];
  }
  modules += "01010";
  for (let index = 7; index < 13; index += 1) {
    modules += R[Number(code[index])];
  }
  return `${modules}101`;
}

// Code 39: nine elements a character (bar, space, bar ...), three of them wide.
export const CODE39: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
  "8": "wnnwnnwnn", "9": "nnwwnnwnn", A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn", F: "nnwnwwnnn",
  G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn", K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww",
  O: "wnnnwnnwn", P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn", U: "wwnnnnnnw", V: "nwwnnnnnw",
  W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "*": "nwnnwnwnn",
  $: "nwnwnwnnn", "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn",
};

function code39Modules(text: string) {
  const framed = `*${text}*`;
  return [...framed]
    .map((char) => {
      let bar = true;
      return [...CODE39[char]]
        .map((width) => {
          const run = (bar ? "1" : "0").repeat(width === "w" ? 3 : 1);
          bar = !bar;
          return run;
        })
        .join("");
    })
    .join("0");
}

export type Bars = { kind: "EAN13" | "CODE39"; /** 1 is a bar, 0 a space, one character a module. */ modules: string };

/** The bars of a code: an EAN-13 when it is one, else Code 39 when every character can be drawn, else none (the number is printed). */
export function barcodeBars(code: string): Bars | null {
  if (isValidEan13(code)) {
    return { kind: "EAN13", modules: ean13Modules(code) };
  }
  const text = code.toUpperCase();
  if (text.length >= 1 && text.length <= 32 && [...text].every((char) => char !== "*" && CODE39[char])) {
    return { kind: "CODE39", modules: code39Modules(text) };
  }
  return null;
}
