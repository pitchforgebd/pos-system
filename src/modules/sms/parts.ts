// How many SMS a message takes (P10 task 6). A message written only in the GSM 7-bit alphabet is 160 characters in one SMS and 153 per part when it is
// split; the characters of the extension table ({ } [ ] ~ | ^ € \) count twice. Anything else, Bangla included, is sent as Unicode: 70 in one SMS,
// 67 per part. Characters are counted as the phone counts them (UTF-16 code units).

const BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const EXTENSION = "^{}\\[~]|€\f";
const basic = new Set([...BASIC]);
const extension = new Set([...EXTENSION]);

export type SmsParts = { encoding: "GSM" | "UNICODE"; length: number; parts: number; perPart: number };

export function smsParts(body: string): SmsParts {
  let gsm = true;
  let septets = 0;
  for (const char of body) {
    if (basic.has(char)) {
      septets += 1;
    } else if (extension.has(char)) {
      septets += 2;
    } else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const parts = septets === 0 ? 1 : septets <= 160 ? 1 : Math.ceil(septets / 153);
    return { encoding: "GSM", length: septets, parts, perPart: parts === 1 ? 160 : 153 };
  }
  const units = body.length;
  const parts = units === 0 ? 1 : units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: "UNICODE", length: units, parts, perPart: parts === 1 ? 70 : 67 };
}
