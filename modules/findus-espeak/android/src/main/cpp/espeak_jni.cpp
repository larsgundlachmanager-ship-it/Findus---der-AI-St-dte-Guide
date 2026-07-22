#include <jni.h>
#include <android/log.h>
#include <mutex>
#include <string>

#include "espeak-ng/speak_lib.h"

#define LOG_TAG "FindusEspeak"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

std::mutex g_mu;
bool g_ready = false;
std::string g_voice = "de";

std::string jstringToUtf8(JNIEnv *env, jstring js) {
  if (!js) return {};
  const char *chars = env->GetStringUTFChars(js, nullptr);
  std::string out = chars ? chars : "";
  if (chars) env->ReleaseStringUTFChars(js, chars);
  return out;
}

jstring utf8ToJstring(JNIEnv *env, const std::string &s) {
  return env->NewStringUTF(s.c_str());
}

bool initEspeak(const std::string &dataParentPath, const std::string &voice) {
  std::lock_guard<std::mutex> lock(g_mu);
  if (g_ready) {
    if (!voice.empty() && voice != g_voice) {
      if (espeak_SetVoiceByName(voice.c_str()) != EE_OK) {
        LOGE("SetVoiceByName(%s) failed", voice.c_str());
        return false;
      }
      g_voice = voice;
    }
    return true;
  }

  // path = parent directory that contains espeak-ng-data/
  int sampleRate = espeak_Initialize(
      AUDIO_OUTPUT_SYNCHRONOUS,
      0,
      dataParentPath.c_str(),
      0);
  if (sampleRate <= 0) {
    LOGE("espeak_Initialize failed (path=%s)", dataParentPath.c_str());
    return false;
  }

  const char *v = voice.empty() ? "de" : voice.c_str();
  if (espeak_SetVoiceByName(v) != EE_OK) {
    // Fallback de vs de-de
    if (espeak_SetVoiceByName("de") != EE_OK) {
      LOGE("espeak_SetVoiceByName(de) failed");
      return false;
    }
    g_voice = "de";
  } else {
    g_voice = v;
  }

  g_ready = true;
  LOGI("espeak-ng ready voice=%s rate=%d path=%s", g_voice.c_str(), sampleRate,
       dataParentPath.c_str());
  return true;
}

std::string textToIpa(const std::string &text, const std::string &voice) {
  std::lock_guard<std::mutex> lock(g_mu);
  if (!g_ready) return {};

  if (!voice.empty() && voice != g_voice) {
    if (espeak_SetVoiceByName(voice.c_str()) == EE_OK) {
      g_voice = voice;
    }
  }

  std::string out;
  out.reserve(text.size() * 2);
  const void *textPtr = text.c_str();
  while (textPtr != nullptr) {
    const char *phones =
        espeak_TextToPhonemes(&textPtr, espeakCHARS_AUTO, espeakPHONEMES_IPA);
    if (phones && phones[0]) {
      out.append(phones);
    }
  }
  return out;
}

} // namespace

extern "C" {

JNIEXPORT jboolean JNICALL
Java_expo_modules_findusespeak_FindusEspeakModule_nativeInit(
    JNIEnv *env, jclass, jstring dataPath, jstring voice) {
  auto path = jstringToUtf8(env, dataPath);
  auto v = jstringToUtf8(env, voice);
  return initEspeak(path, v) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL
Java_expo_modules_findusespeak_FindusEspeakModule_nativeIsReady(JNIEnv *, jclass) {
  return g_ready ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL
Java_expo_modules_findusespeak_FindusEspeakModule_nativeTextToPhonemes(
    JNIEnv *env, jclass, jstring text, jstring voice) {
  auto t = jstringToUtf8(env, text);
  auto v = jstringToUtf8(env, voice);
  auto ipa = textToIpa(t, v);
  return utf8ToJstring(env, ipa);
}

JNIEXPORT jstring JNICALL
Java_expo_modules_findusespeak_FindusEspeakModule_nativeGetVoice(
    JNIEnv *env, jclass) {
  return utf8ToJstring(env, g_voice);
}

} // extern "C"
