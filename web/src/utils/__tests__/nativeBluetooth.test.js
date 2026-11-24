import { afterEach, describe, expect, it, vi } from 'vitest';

// Capacitor reads window.androidBridge and window.Capacitor.PluginHeaders when
// @capacitor/core first loads, so each case sets them and re-imports.
async function loadAsAndroid() {
  vi.resetModules();
  window.androidBridge = { postMessage() {} };
  window.Capacitor = {
    PluginHeaders: [
      {
        name: 'BluetoothLowEnergy',
        methods: [{ name: 'isAvailable', rtype: 'promise' }],
      },
    ],
  };
  delete navigator.bluetooth;
  return {
    ...(await import('../nativeBluetooth.js')),
    ...(await import('@capgo/capacitor-bluetooth-low-energy')),
  };
}

afterEach(() => {
  delete window.androidBridge;
  delete window.Capacitor;
  delete window.__capgoBluetoothLowEnergyShimInstalled;
  delete navigator.bluetooth;
});

describe('installNativeBluetooth', () => {
  it('puts navigator.bluetooth on the Android WebView', async () => {
    const { installNativeBluetooth } = await loadAsAndroid();
    installNativeBluetooth();
    expect(typeof navigator.bluetooth?.requestDevice).toBe('function');
  });

  it("the plugin's own shimWebBluetooth() does not, which is why this exists", async () => {
    const { BluetoothLowEnergy } = await loadAsAndroid();
    await expect(BluetoothLowEnergy.shimWebBluetooth()).rejects.toThrow(
      /not implemented on android/
    );
    expect(navigator.bluetooth).toBeUndefined();
  });

  it('does nothing on the web', async () => {
    vi.resetModules();
    const { installNativeBluetooth } = await import('../nativeBluetooth.js');
    installNativeBluetooth();
    expect(navigator.bluetooth).toBeUndefined();
  });
});
