// Serial debug console on UART0, 115200 baud. Type `help`.
#pragma once
#include "settings.h"

void consoleBegin(Settings* s);
void consoleService();
bool consoleBusy();         // streaming or rate logging: keeps the board awake
bool consoleSleepRequested();
