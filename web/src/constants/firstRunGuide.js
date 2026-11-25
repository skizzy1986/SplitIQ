// First-run guide copy for the testers build (#797). English and Spanish side
// by side, like the tester notice: kept whole, and out of the message catalogs
// so a long walkthrough does not spend the dashboard's Spanish budget (dash es
// is already tight). Informal es-CO, no usted. Not legal advice.
//
// The sample-data branch should set sessions.source = 'sample'. This guide
// treats that value as the only flag, and testers can clear those rows.

export const GUIDE = {
  en: {
    title: 'A quick look around',
    skip: 'Skip',
    next: 'Next',
    back: 'Back',
    done: 'Done',
    openGuide: 'See the guide again',
    steps: [
      {
        id: 'welcome',
        title: 'Welcome to the test build',
        body: "This is a public-facing test of SplitIQ, not the owner's personal app. The next few screens walk through the main features. You can skip and come back later from Today.",
      },
      {
        id: 'today',
        title: 'Today',
        body: 'Today is the home screen: what is planned, and a way to start a row or log what you did. If you have sample sessions, they are marked as sample data so they are not mixed up with your own.',
      },
      {
        id: 'cp',
        title: 'Your rowing CP',
        body: 'Critical Power (CP) is the wattage the app uses to understand your rowing. If it is not set yet, enter it below. You can change it later. A typical trained value is around 180–250 W; enter what is right for you, not a guess from someone else.',
        hasCp: true,
      },
      {
        id: 'plan-log',
        title: 'Plan and log',
        body: "Use Plan to set up a session, and Log to record one you have already done. Strength sets belong there too. Nothing from the owner's own training will appear on your account.",
      },
      {
        id: 'progress-body',
        title: 'Progress and Body',
        body: 'Progress is load, history and whether the training is working. Body is for readiness. Health record screens and third-party connections are hidden on this test build, so Body may look empty until you have your own readings.',
      },
      {
        id: 'squat',
        title: 'Anatomy tool',
        body: 'The squat anatomy tool is a public page, at /squat, for looking at how a squat works. It is separate from your training log. Open it from the button below, or type the address in a browser.',
        hasSquat: true,
      },
      {
        id: 'samples',
        title: 'Sample sessions',
        body: 'If sample sessions were added to your account so the screens are not blank, they are flagged as sample data. Clear them whenever you like; your own logged sessions stay. A later change will add the samples themselves — this step already knows how to recognise and clear them.',
        hasSamples: true,
      },
    ],
    welcomeCard: {
      title: 'Welcome',
      body: 'A short guide to the main features is ready when you are. You can also set your rowing CP here if it is not set yet.',
      cpLabel: 'Rowing CP (watts)',
      cpSave: 'Save CP',
      cpSaved: 'Rowing CP saved.',
      cpMissing: 'Enter a whole number between 50 and 500.',
      cpError: 'Could not save that. Try again.',
      notSet: 'Rowing CP not set yet.',
      openGuide: 'Open the guide',
      dismiss: 'Hide this card',
      openSquat: 'Open the anatomy tool',
      sampleBadge: 'Sample data',
      clearSamples: 'Clear sample sessions',
      clearConfirm:
        'Clear the sample sessions from this account? Your own sessions are not touched.',
      cleared: 'Sample sessions cleared.',
      clearError: 'Could not clear the sample sessions. Try again.',
      noneToClear: 'There are no sample sessions on this account.',
    },
  },
  es: {
    title: 'Un vistazo rápido',
    skip: 'Omitir',
    next: 'Siguiente',
    back: 'Atrás',
    done: 'Listo',
    openGuide: 'Ver la guía otra vez',
    steps: [
      {
        id: 'welcome',
        title: 'Bienvenido a la versión de prueba',
        body: 'Esta es una versión de prueba pública de SplitIQ, no la app personal del dueño. Las siguientes pantallas recorren las funciones principales. Puedes omitirla y volver más tarde desde Hoy.',
      },
      {
        id: 'today',
        title: 'Hoy',
        body: 'Hoy es la pantalla de inicio: lo que hay planeado, y un modo de empezar un remo o registrar lo que ya hiciste. Si hay sesiones de ejemplo, están marcadas como datos de ejemplo para no mezclarlas con las tuyas.',
      },
      {
        id: 'cp',
        title: 'Tu CP de remo',
        body: 'La potencia crítica (CP) es el valor en vatios que usa la app para entender tu remo. Si todavía no está definida, introdúcela abajo. Puedes cambiarla después. Un valor típico de alguien entrenado está en torno a 180–250 W; pon el que sea correcto para ti, no una cifra de otra persona.',
        hasCp: true,
      },
      {
        id: 'plan-log',
        title: 'Planificar y registrar',
        body: 'Usa Plan para preparar una sesión, y Registro para anotar una que ya hiciste. Las series de fuerza también van ahí. El entrenamiento personal del dueño no aparece en tu cuenta.',
      },
      {
        id: 'progress-body',
        title: 'Progreso y Cuerpo',
        body: 'Progreso es la carga, el historial y si el entrenamiento está funcionando. Cuerpo es para la preparación. En esta versión de prueba las pantallas de salud y las conexiones externas están ocultas, así que Cuerpo puede verse vacío hasta que tengas tus propias lecturas.',
      },
      {
        id: 'squat',
        title: 'Herramienta de anatomía',
        body: 'La herramienta de anatomía de la sentadilla es una página pública, en /squat, para ver cómo funciona una sentadilla. Es independiente de tu registro. Ábrela con el botón de abajo, o escribe la dirección en el navegador.',
        hasSquat: true,
      },
      {
        id: 'samples',
        title: 'Sesiones de ejemplo',
        body: 'Si se añadieron sesiones de ejemplo a tu cuenta para que las pantallas no queden en blanco, están marcadas como datos de ejemplo. Puedes borrarlas cuando quieras; las sesiones que registres tú se quedan. Un cambio posterior añadirá las sesiones en sí: este paso ya sabe reconocerlas y borrarlas.',
        hasSamples: true,
      },
    ],
    welcomeCard: {
      title: 'Bienvenido',
      body: 'Hay una guía corta de las funciones principales cuando quieras. También puedes definir aquí tu CP de remo si todavía no está.',
      cpLabel: 'CP de remo (vatios)',
      cpSave: 'Guardar CP',
      cpSaved: 'CP de remo guardada.',
      cpMissing: 'Introduce un número entero entre 50 y 500.',
      cpError: 'No se pudo guardar. Inténtalo de nuevo.',
      notSet: 'CP de remo aún no definida.',
      openGuide: 'Abrir la guía',
      dismiss: 'Ocultar esta tarjeta',
      openSquat: 'Abrir la herramienta de anatomía',
      sampleBadge: 'Datos de ejemplo',
      clearSamples: 'Borrar sesiones de ejemplo',
      clearConfirm:
        '¿Borrar las sesiones de ejemplo de esta cuenta? Las tuyas no se tocan.',
      cleared: 'Sesiones de ejemplo borradas.',
      clearError:
        'No se pudieron borrar las sesiones de ejemplo. Inténtalo de nuevo.',
      noneToClear: 'No hay sesiones de ejemplo en esta cuenta.',
    },
  },
};

export function guideFor(locale) {
  return /^es(-|$)/i.test(String(locale ?? '')) ? GUIDE.es : GUIDE.en;
}
