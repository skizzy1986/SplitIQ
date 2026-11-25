// First-run guide copy for the testers build (#797). English and Spanish side
// by side, like the tester notice: kept whole, and out of the message catalogs
// so a long walkthrough does not spend the dashboard's Spanish budget (dash es
// is already tight). Informal es-CO, no usted. Not legal advice.
//
// Sample data comes from migration 024 (#812) and is cleared through
// clear_my_sample_data(); sessions.source = 'sample' is how the UI recognises
// sample sessions.

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
        body: 'Today is the home screen: what is planned, and a way to start a row or log what you did. New test accounts start with made-up sample sessions so the screens are not blank. They are marked as sample data so they are not mixed up with your own.',
      },
      {
        id: 'cp',
        title: 'Your rowing CP',
        body: 'Critical Power (CP) is the wattage the app uses to understand your rowing. If it is not set yet, or it is the 200 W placeholder that comes with the sample data, enter yours below. You can change it later. A typical trained value is around 180–250 W; enter what is right for you, not a guess from someone else.',
        hasCp: true,
      },
      {
        id: 'plan-log',
        title: 'Plan and log',
        body: "Use Train to plan a session or start an erg or strength session. Progress, then History, lists what you have logged, and you can add one you have already done from there. Nothing from the owner's own training will appear on your account.",
      },
      {
        id: 'progress-body',
        title: 'Progress and Body',
        body: 'Progress is load, erg, strength and history: whether the training is working. Body is where vitals appear. Health records, readiness and third-party connections are hidden on this test build, so Body will look empty.',
      },
      {
        id: 'squat',
        title: 'Anatomy tool',
        body: 'The squat anatomy tool is a public page, at /squat, for looking at how a squat works. It is separate from your training log. Open it from the button below, or type the address in a browser.',
        hasSquat: true,
      },
      {
        id: 'samples',
        title: 'Sample data',
        body: 'New test accounts start with made-up sample data so the screens are not blank: about eight weeks of erg and strength sessions, and a 200 W placeholder CP. It is all marked as sample data. Clear it whenever you like. That removes only the sample data, and the sessions you log yourself stay. If you have not set your own CP, clearing also removes the placeholder, so CP will show as not set.',
        hasSamples: true,
      },
    ],
    welcomeCard: {
      title: 'Welcome',
      body: 'A short guide to the main features is ready when you are. You can also set or change your rowing CP here.',
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
      clearSamples: 'Clear sample data',
      clearConfirm:
        'Clear all sample data from this account (sample sessions, strength workouts and the placeholder CP)? Your own sessions and your own CP are not touched.',
      cleared: 'Sample data cleared.',
      clearError: 'Could not clear the sample data. Try again.',
      noneToClear: 'There is no sample data on this account.',
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
        body: 'Hoy es la pantalla de inicio: lo que hay planeado, y un modo de empezar un remo o registrar lo que ya hiciste. Las cuentas de prueba nuevas empiezan con sesiones de ejemplo inventadas para que las pantallas no queden en blanco. Están marcadas como datos de ejemplo para no mezclarlas con las tuyas.',
      },
      {
        id: 'cp',
        title: 'Tu CP de remo',
        body: 'La potencia crítica (CP) es el valor en vatios que usa la app para entender tu remo. Si todavía no está definida, o es la CP provisional de 200 W que viene con los datos de ejemplo, introduce la tuya abajo. Puedes cambiarla después. Un valor típico de alguien entrenado está en torno a 180–250 W; pon el que sea correcto para ti, no una cifra de otra persona.',
        hasCp: true,
      },
      {
        id: 'plan-log',
        title: 'Planificar y registrar',
        body: 'Usa Entrenar para planificar una sesión o empezar una de ergómetro o de fuerza. En Progreso, luego Historial, ves lo que has registrado, y desde ahí puedes añadir una que ya hiciste. El entrenamiento personal del dueño no aparece en tu cuenta.',
      },
      {
        id: 'progress-body',
        title: 'Progreso y Cuerpo',
        body: 'Progreso es la carga, el ergómetro, la fuerza y el historial: si el entrenamiento está funcionando. Cuerpo es donde aparecen los signos vitales. En esta versión de prueba los registros de salud, la preparación y las conexiones externas están ocultos, así que Cuerpo se verá vacío.',
      },
      {
        id: 'squat',
        title: 'Herramienta de anatomía',
        body: 'La herramienta de anatomía de la sentadilla es una página pública, en /squat, para ver cómo funciona una sentadilla. Es independiente de tu registro. Ábrela con el botón de abajo, o escribe la dirección en el navegador.',
        hasSquat: true,
      },
      {
        id: 'samples',
        title: 'Datos de ejemplo',
        body: 'Las cuentas de prueba nuevas empiezan con datos de ejemplo inventados para que las pantallas no queden en blanco: unas ocho semanas de sesiones de remo y de fuerza, y una CP provisional de 200 W. Todo está marcado como datos de ejemplo. Bórralos cuando quieras. Solo se borran los datos de ejemplo, y las sesiones que registres tú se quedan. Si no has definido tu propia CP, al borrar también se quita la provisional y la CP aparecerá como no definida.',
        hasSamples: true,
      },
    ],
    welcomeCard: {
      title: 'Bienvenido',
      body: 'Hay una guía corta de las funciones principales cuando quieras. También puedes definir o cambiar aquí tu CP de remo.',
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
      clearSamples: 'Borrar datos de ejemplo',
      clearConfirm:
        '¿Borrar todos los datos de ejemplo de esta cuenta (sesiones, entrenamientos de fuerza y la CP provisional)? Tus sesiones y tu propia CP no se tocan.',
      cleared: 'Datos de ejemplo borrados.',
      clearError:
        'No se pudieron borrar los datos de ejemplo. Inténtalo de nuevo.',
      noneToClear: 'No hay datos de ejemplo en esta cuenta.',
    },
  },
};

export function guideFor(locale) {
  return /^es(-|$)/i.test(String(locale ?? '')) ? GUIDE.es : GUIDE.en;
}
