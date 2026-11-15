// What a new password must be (S10): at least 10 characters, not a common password, not made from the person's own email or name. It is checked wherever
// a password is set: a reset, a change, a new user, the first owner. Signing in is not checked: an older, shorter password still works until it is changed.

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

// The passwords people choose most, and the words they are built from. A password is turned to lower case, the common letter-for-symbol swaps are undone
// (@ for a, 0 for o, $ for s ...) and the digits and symbols at its end are cut off before it is looked up here, so Password123! and P@ssw0rd2026 are
// refused as well as password. The list is the several hundred most common ones, not every leaked password; it stops the guesses an attacker tries first.
const COMMON = new Set(
  `123456 1234567 12345678 123456789 1234567890 12345678910 0123456789 987654321 9876543210 654321 111111 11111111 1111111111 000000 00000000 0000000000
  password passw0rd pass1234 password1 password12 password123 password1234 pass word passwd p4ssw0rd passw0rd1 secret secret123 mypassword mypass
  qwerty qwerty1 qwerty12 qwerty123 qwertyuiop qwertyuio qwertyui qwert azerty qwertz asdfgh asdfghjk asdfghjkl asdf zxcvbn zxcvbnm zxcvbnm123 1q2w3e 1q2w3e4r 1q2w3e4r5t
  1qaz2wsx 1qaz2wsx3edc qazwsx qazwsxedc qazwsx123 zaq12wsx abc123 abc1234 abcd1234 abcd123 abcdef abcdefg abcdefgh abcdefghi abcdefghij abc12345 aaaaaa aaaaaaaa
  iloveyou iloveyou1 iloveyou123 ilovemyself ilovemom ilovedad ilovejesus loveyou love lovely lover1 lovelove loveme sweetheart sweetie angel angel123 angels
  letmein letmein1 letmein123 welcome welcome1 welcome123 welcome1234 admin admin1 admin123 admin1234 admin12345 adminadmin administrator administrator1 root toor
  login login123 user user123 guest guest123 test test123 test1234 testing testing123 demo demo123 default changeme changeme123 temp temp123 temporary
  monkey monkey123 dragon dragon123 master master123 shadow shadow123 superman superman123 batman batman123 spiderman hunter hunter123 trustno1 sunshine sunshine1
  princess princess1 football football1 baseball baseball1 soccer soccer1 basketball cricket cricket123 hockey tennis golf golfer biggie jordan jordan23 michael michael1
  jennifer jessica jessica1 ashley ashley1 daniel daniel1 thomas thomas1 robert robert1 charlie charlie1 andrew andrew1 matthew matthew1 joshua joshua1 nicole nicole1
  hannah hannah1 amanda amanda1 summer summer1 winter winter1 spring autumn flower flower1 butterfly butterfly1 rainbow rainbow1 cookie cookie1 chocolate chocolate1
  banana cheese orange purple silver golden diamond diamond1 forever forever1 freedom freedom1 whatever whatever1 nothing nothing1 anything everything
  starwars startrek matrix pokemon naruto harrypotter google facebook youtube twitter instagram whatsapp amazon apple microsoft windows linux ubuntu computer
  computer1 internet internet1 mobile mobile1 samsung nokia iphone android hello hello123 hello1234 hellohello helloworld hi123 hey123 thanks thankyou
  mustang ferrari porsche mercedes toyota honda yamaha camaro corvette harley bigdaddy bigboy bigdog doggie puppy kitty kitten tigger tiger tiger123 lion lion123
  bangladesh bangladesh1 bangladesh123 bangladeshi dhaka dhaka123 dhaka1234 dhaka12345 chittagong chattogram sylhet rajshahi khulna barisal rangpur mymensingh
  bangla bangla123 amarshonarbangla ami tumi bhalobasi allah allah123 allahu muhammad muhammad1 mohammad rahman rahim karim kamal jamal salam islam islam123 bismillah
  inshallah mashallah alhamdulillah subhanallah bhai bhai123 bhaiya apu mama baba maa jaan jaan123 shona shona123 shonar bondhu bondhu123 pagla pagla123
  meridian meridian1 meridian123 meridian1234 meridian12345 meridianerp greenagricare greenagricare1 agricare agricare123 agriculture pitchforge pitchforgebd
  shop shop123 store store123 market business business1 company company1 office office123 manager manager123 cashier cashier123 owner owner123 account account123
  accounts accounting inventory inventory1 pos pos123 posadmin sales sales123 billing billing123 invoice invoice123 money money123 cash cash123 bank bank123 taka taka123
  qwer1234 qwer12345 qwerasdf qweasd qweasdzxc qweasdzxc123 asdf1234 asdf12345 zxcv1234 zxcvbnm1 1234qwer 1234abcd 12345qwert 12345abcde abcde12345 a1b2c3 a1b2c3d4 a1b2c3d4e5
  q1w2e3 q1w2e3r4 q1w2e3r4t5 q1w2e3r4t5y6 qwe123 qwe12345 123qwe 123qweasd 123abc 123abcd 123456a 123456q 12345a 1234a 1234qwer 123123 123123123 123321 123321123 112233 112233445566
  121212 12121212 131313 696969 696969696 69696969 777777 7777777 77777777 888888 88888888 999999 99999999 666666 6666666 555555 5555555 444444 4444444 333333 3333333 222222 2222222
  010101 101010 102030 1020304050 123654 123654789 147258 147258369 159357 159753 1593572468 258456 321321 321654 321654987 456789 456123 789456 789456123 741852963 852456 963852741
  147852369 7894561230 1357924680 1472583690 2468013579 1029384756 1928374650 11223344 1122334455 112233445 12341234 123412341234 123123123123 12345612345 1234512345 1234554321 12344321
  samplepassword defaultpassword newpassword newpass changepassword resetpassword yourpassword mypassword1 mypassword123 thepassword passwordpassword passcode pass pass123
  princess123 sunshine123 iloveu iloveu123 ilove ilove123 loveu loveu123 babygirl babygirl1 babyboy lovers lovers1 darling darling1 honey honey123 cutie cutie123 pretty pretty1
  sexy sexy123 sexygirl`
    .split(/\s+/)
    .filter(Boolean),
);

const SYMBOL_SWAPS: Record<string, string> = { "@": "a", "4": "a", "0": "o", "$": "s", "5": "s", "3": "e", "1": "i", "!": "i", "7": "t" };

/** The password with the usual swaps undone and the digits and symbols at its end removed: what it is built from. */
function rootOf(password: string) {
  const lower = password.toLowerCase();
  const trimmed = lower.replace(/[^a-z]+$/u, "");
  const swapped = [...trimmed].map((char) => SYMBOL_SWAPS[char] ?? char).join("");
  return { lower, trimmed, swapped: swapped.replace(/[^a-z]+$/u, "") };
}

export type PasswordContext = { email?: string | null; name?: string | null };

export type PasswordProblemCode = "short" | "long" | "repeat" | "common" | "sequence" | "email" | "name";

/** Why a password is not acceptable, as a code (a screen turns it into a sentence in the person's language), or null when it is acceptable. */
export function passwordProblemCode(password: string, context: PasswordContext = {}): PasswordProblemCode | null {
  if (password.length < PASSWORD_MIN) {
    return "short";
  }
  if (password.length > PASSWORD_MAX) {
    return "long";
  }
  if (new Set(password).size <= 2) {
    return "repeat";
  }
  const { lower, trimmed, swapped } = rootOf(password);
  if (COMMON.has(lower) || COMMON.has(trimmed) || COMMON.has(swapped)) {
    return "common";
  }
  // a run along the keyboard or the alphabet, nothing else
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop|asdfghjkl|zxcvbnm)/u.test(lower) && lower.length <= 14) {
    return "sequence";
  }
  const letters = lower.replace(/[^a-z0-9]/gu, "");
  const local = ((context.email ?? "").split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9]/gu, "");
  if (local.length >= 4 && letters.includes(local)) {
    return "email";
  }
  const name = (context.name ?? "").trim().toLowerCase().replace(/[^a-z0-9]/gu, "");
  if (name.length >= 4 && letters.includes(name)) {
    return "name";
  }
  return null;
}

const MESSAGES: Record<PasswordProblemCode, string> = {
  short: `Use at least ${PASSWORD_MIN} characters.`,
  long: `Use at most ${PASSWORD_MAX} characters.`,
  repeat: "That password repeats the same characters. Choose another.",
  common: "That password is too common. Choose another.",
  sequence: "That password is a simple sequence. Choose another.",
  email: "The password must not contain your email name.",
  name: "The password must not contain your name.",
};

/** The reason a password is not acceptable, in English (what the server answers), or null when it is acceptable. */
export function passwordProblem(password: string, context: PasswordContext = {}): string | null {
  const code = passwordProblemCode(password, context);
  return code ? MESSAGES[code] : null;
}
