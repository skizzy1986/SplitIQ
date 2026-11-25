// The tester notice shown above the consent tick on the invite sign-up form
// (#791). English and Spanish side by side, like BRAND_LINE: one document per
// language, kept whole so a translator or a reviewer reads it as a piece. It is
// not in the message catalogs, which also keeps a long legal-ish text out of
// the Spanish catalog budget.
//
// PLACEHOLDER. The wording is the owner's to approve, not ours: this is
// NOTICE-draft.md as it stands (with the owner's name taken out, because
// scripts/check-names.mjs keeps first-person names out of web/src), and it
// stays marked as a draft on screen (the banner below) until the owner says yes. Sign-off is three edits, together:
//   1. put his final wording in NOTICE below,
//   2. set NOTICE_APPROVED to true,
//   3. change CONSENT_VERSION in supabase/functions/invite-signup/logic.ts from
//      "draft-1" to a dated version, so each account records which text it saw.
// Not legal advice.
export const NOTICE_APPROVED = false;

export const NOTICE = {
  en: {
    title: 'SplitIQ test access',
    paragraphs: [
      "SplitIQ is a private hobby project, not a business. You've been invited to try a public-facing test build. This is not the owner's personal app.",
      "What it stores: your email, and the training you log (sessions, strength sets, your rowing settings), in a database hosted by Supabase in Sydney. Please don't enter health records such as blood pressure, medication or blood tests; those screens are hidden in this build.",
      'Who can see it: the person who runs the database, and the tools they use to maintain it. Other testers cannot see your data. The owner may look at data to fix problems.',
      'If something breaks: message whoever invited you and tell them what you were doing. This is a test build, so things can change, break, or lose data. If the test service is idle it may pause until it is restarted.',
      'Your choices: ask whoever invited you at any time and they will delete your account and data.',
    ],
    consent: "I'm 18 or over and I agree to this.",
    draft:
      "DRAFT WORDING: waiting for the owner's OK. Don't send this to a tester yet.",
  },
  es: {
    title: 'Acceso de prueba a SplitIQ',
    paragraphs: [
      'SplitIQ es un proyecto personal, no un negocio. Te han invitado a probar una versión de prueba para testers. Esta no es la app personal del dueño.',
      'Qué se guarda: tu correo, y el entrenamiento que registres (sesiones, series de fuerza, tu configuración de remo), en una base de datos de Supabase en Sídney. Por favor, no introduzcas datos de salud como presión arterial, medicación o análisis de sangre; esas pantallas están ocultas en esta versión.',
      'Quién puede verlo: la persona que administra la base de datos, y las herramientas que usa para mantenerla. Los demás testers no pueden ver tus datos. El dueño puede consultar datos para corregir problemas.',
      'Si algo falla: escríbele a quien te invitó y cuéntale qué estabas haciendo. Esta es una versión de prueba: puede cambiar, fallar, y los datos pueden perderse. Si el servicio de prueba queda inactivo, puede pausarse hasta que se reinicie.',
      'Tus opciones: puedes pedirle en cualquier momento a quien te invitó que borre tu cuenta y tus datos.',
    ],
    consent: 'Tengo 18 años o más y acepto esto.',
    draft:
      'BORRADOR: falta el visto bueno del dueño. Todavía no lo envíes a ningún tester.',
  },
};

export function noticeFor(locale) {
  return /^es(-|$)/i.test(String(locale ?? '')) ? NOTICE.es : NOTICE.en;
}
