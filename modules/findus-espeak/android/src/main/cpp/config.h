/* Minimal Android config for espeak-ng (phonemize-only). */
#pragma once

#define PACKAGE_VERSION "1.52.0"
#define HAVE_UNISTD_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRING_H 1
#define HAVE_MEMORY_H 1
#define HAVE_MALLOC 1
#define HAVE_REALLOC 1
#define HAVE_FREE 1
#define HAVE_MEMSET 1
#define HAVE_STRLEN 1
#define HAVE_STRDUP 1
#define HAVE_GETOPT_H 0
#define USE_ASYNC 0
#define USE_KLATT 0
#define USE_SPEECHPLAYER 0
#define USE_MBROLA 0
#define USE_LIBSONIC 0
#define USE_LIBPCAUDIO 0
#define USE_KAULAHAN 0
#define HAVE_MKFIFO 0
#define HAVE_FORK 0
#define HAVE_PRCTL 0
#define HAVE_WAV_H 0

#ifdef ANDROID
#define PLATFORM_ANDROID 1
#endif
