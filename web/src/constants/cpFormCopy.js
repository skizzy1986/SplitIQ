// Words for the rowing CP entry form (SetRowingCpForm). Kept whole and out of
// the message catalogs, like the first-run guide, so they do not spend the
// dashboard's Spanish budget. Informal es-CO, no usted.
//
// Nothing mounts the form right now (#819 H 1, H 2): a new tester is never
// asked for a CP. Slice S4's AdvancedCpForm brings it back, behind the expert
// depth, and takes these words with it.

export const CP_FORM = {
  en: {
    cpLabel: 'Rowing CP (watts)',
    cpSave: 'Save CP',
    cpSaved: 'Rowing CP saved.',
    cpMissing: 'Enter a whole number between 50 and 500.',
    cpError: 'Could not save that. Try again.',
  },
  es: {
    cpLabel: 'CP de remo (vatios)',
    cpSave: 'Guardar CP',
    cpSaved: 'CP de remo guardada.',
    cpMissing: 'Introduce un número entero entre 50 y 500.',
    cpError: 'No se pudo guardar. Inténtalo de nuevo.',
  },
};

export function cpFormFor(locale) {
  return /^es(-|$)/i.test(String(locale ?? '')) ? CP_FORM.es : CP_FORM.en;
}
