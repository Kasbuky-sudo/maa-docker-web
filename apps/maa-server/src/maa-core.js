'use strict';

// Thin FFI binding over the official MAA runtime's libMaaCore.so
// (signatures from the runtime-shipped AsstCaller.h, MAA v6.17.5).
// koffi is loaded lazily so the module can be required on any platform.

const path = require('node:path');
const runtime = require('./runtime');

let lib = null;
let fns = null;
let cbProto = null;

function available() {
  try {
    funcs();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function load() {
  if (lib) return lib;
  const koffi = require('koffi'); // lazy: not installed/usable on dev machines
  const dir = runtime._internal.runtimeRoot();
  if (!dir) throw new Error('MAA 运行包不存在（请先在 Runtime 页下载）');
  lib = koffi.load(path.join(dir, 'libMaaCore.so'));
  return lib;
}

// koffi.register needs the proto *object*, not its name
function callbackProto() {
  const koffi = require('koffi');
  if (!cbProto) cbProto = koffi.proto('AsstApiCallback', 'void', ['int32_t', 'const char *', 'void *']);
  return cbProto;
}

// koffi 2.x register(fn, '<Proto> *' | pointer(proto)); wrap both attempts here
function registerCallback(fn) {
  const koffi = require('koffi');
  callbackProto();
  try {
    return koffi.register(fn, 'AsstApiCallback *');
  } catch {
    return koffi.register(fn, koffi.pointer(cbProto));
  }
}

function funcs() {
  if (fns) return fns;
  callbackProto(); // register named proto before the signature referencing it
  const L = lib || load();
  fns = {
    getVersion: L.func('const char *AsstGetVersion()'),
    setUserDir: L.func('uint8_t AsstSetUserDir(const char *path)'),
    loadResource: L.func('uint8_t AsstLoadResource(const char *path)'),
    createEx: L.func('void *AsstCreateEx(AsstApiCallback *callback, void *custom_arg)'),
    destroy: L.func('void AsstDestroy(void *handle)'),
    appendTask: L.func('int32_t AsstAppendTask(void *handle, const char *type, const char *params)'),
    setTaskParams: L.func('uint8_t AsstSetTaskParams(void *handle, int32_t id, const char *params)'),
    start: L.func('uint8_t AsstStart(void *handle)'),
    stop: L.func('uint8_t AsstStop(void *handle)'),
    running: L.func('uint8_t AsstRunning(void *handle)'),
    connected: L.func('uint8_t AsstConnected(void *handle)'),
    asyncConnect: L.func('int32_t AsstAsyncConnect(void *handle, const char *adb_path, const char *address, const char *config, uint8_t block)'),
  };
  return fns;
}

module.exports = { available, funcs, callbackProto, registerCallback };
