// Puts navigator.bluetooth on the Android app's WebView, which has no Web
// Bluetooth of its own, so services/pm5Bluetooth.js runs unchanged there.
//
// Not BluetoothLowEnergy.shimWebBluetooth(): @capgo/capacitor-bluetooth-low-energy
// 8.2.9 assigns that helper onto the registerPlugin() Proxy, which has no set
// trap and turns every property read into a native call. On Android the call
// asks the native plugin for a method it does not have, rejects with "not
// implemented on android", and the shim is never installed. Calling the
// installer directly is what the helper meant to do. It is a no-op on the web
// and when navigator.bluetooth already exists (#766).
import { BluetoothLowEnergy } from '@capgo/capacitor-bluetooth-low-energy';
import { installBluetoothLowEnergyShim } from '@capgo/capacitor-bluetooth-low-energy/dist/esm/shim.js';

export function installNativeBluetooth() {
  installBluetoothLowEnergyShim(BluetoothLowEnergy);
}
