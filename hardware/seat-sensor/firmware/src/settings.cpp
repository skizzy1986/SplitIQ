#include "settings.h"

#include <Preferences.h>

#include "config.h"

static const char* NS = "seat";

void settingsLoad(Settings& s) {
  Preferences p;
  p.begin(NS, true);
  s.nm_per_count = p.getUInt("nmpc", DEFAULT_NM_PER_COUNT);
  s.direction = p.getChar("dir", DEFAULT_DIRECTION);
  s.home_pos_01mm = p.getShort("home", DEFAULT_HOME_POS_01MM);
  p.end();
  // A corrupt or hand-edited value must not turn the scale into nonsense.
  if (s.nm_per_count < 1000 || s.nm_per_count > 1000000) s.nm_per_count = DEFAULT_NM_PER_COUNT;
  if (s.direction != 1 && s.direction != -1) s.direction = DEFAULT_DIRECTION;
}

void settingsSave(const Settings& s) {
  Preferences p;
  p.begin(NS, false);
  p.putUInt("nmpc", s.nm_per_count);
  p.putChar("dir", s.direction);
  p.putShort("home", s.home_pos_01mm);
  p.end();
}

void settingsReset(Settings& s) {
  Preferences p;
  p.begin(NS, false);
  p.clear();
  p.end();
  settingsLoad(s);
}
