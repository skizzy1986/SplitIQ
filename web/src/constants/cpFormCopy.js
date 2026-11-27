// Words for Settings > Advanced: the rowing CP form (AdvancedCpForm) and where
// the CP came from (AnchorProvenance). Kept whole and out of the message
// catalogs, like the first-run guide, so they do not spend the dashboard's
// Spanish budget (#819 S4, Gate 2 decision 6). Informal es-CO, no usted.
//
// Shown only at expert depth (#819 S4, decision 2). At simple depth, and for
// a new tester, nothing here is on screen.

export const CP_FORM = {
  en: {
    advancedTitle: 'Advanced',
    cpLabel: 'Rowing CP (watts)',
    cpSave: 'Save CP',
    cpSaved: 'Rowing CP saved.',
    cpMissing: 'Enter a whole number between 50 and 500.',
    cpError: 'Could not save that. Try again.',
    cpStale:
      'Your CP changed on another device. Check the value below and save again.',
    provenanceTitle: 'Where your CP comes from',
    noCp: 'No CP saved yet.',
    originLabel: 'Origin',
    dateLabel: 'Valid from',
    protocolLabel: 'Protocol',
    protocolNone: 'Not from a test',
    earlierTitle: 'Earlier values',
    origins: {
      test: 'CP test',
      manual: 'Typed in',
      tester: 'Typed in',
      observed: 'Seen in a session',
      estimate: 'Estimated',
      auto: 'Calibrated from your sessions',
      onboarding: 'Set when you started',
      sample: 'Sample data',
      unknown: 'Not recorded',
    },
    protocols: {
      '2k_6k': '2k + 6k test',
      '3_12': '3 min + 12 min test',
      ftp_30: '30 min test',
    },
  },
  es: {
    advancedTitle: 'Avanzado',
    cpLabel: 'CP de remo (vatios)',
    cpSave: 'Guardar CP',
    cpSaved: 'CP de remo guardada.',
    cpMissing: 'Introduce un número entero entre 50 y 500.',
    cpError: 'No se pudo guardar. Inténtalo de nuevo.',
    cpStale:
      'Tu CP cambió en otro dispositivo. Revisa el valor de abajo y guarda de nuevo.',
    provenanceTitle: 'De dónde sale tu CP',
    noCp: 'Aún no hay CP guardada.',
    originLabel: 'Origen',
    dateLabel: 'Válida desde',
    protocolLabel: 'Protocolo',
    protocolNone: 'No viene de una prueba',
    earlierTitle: 'Valores anteriores',
    origins: {
      test: 'Prueba de CP',
      manual: 'Escrita por ti',
      tester: 'Escrita por ti',
      observed: 'Vista en una sesión',
      estimate: 'Estimada',
      auto: 'Calibrada con tus sesiones',
      onboarding: 'Fijada al empezar',
      sample: 'Datos de ejemplo',
      unknown: 'Sin registrar',
    },
    protocols: {
      '2k_6k': 'Prueba de 2k + 6k',
      '3_12': 'Prueba de 3 min + 12 min',
      ftp_30: 'Prueba de 30 min',
    },
  },
};

export function cpFormFor(locale) {
  return /^es(-|$)/i.test(String(locale ?? '')) ? CP_FORM.es : CP_FORM.en;
}
