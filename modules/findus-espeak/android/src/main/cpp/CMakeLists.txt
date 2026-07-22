cmake_minimum_required(VERSION 3.18.1)
project(findus_espeak LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)

# Headers from fetched espeak-ng sources
set(ESPEAK_INC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/espeak-ng/src/include")
if(NOT EXISTS "${ESPEAK_INC_DIR}/espeak-ng/speak_lib.h")
  message(FATAL_ERROR
    "espeak-ng headers missing. Run: node scripts/fetch-espeak-ng.cjs")
endif()

# Prebuilt libttsespeak.so from official espeak-ng Android APK (per-ABI)
set(PREBUILT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}")
set(PREBUILT_SO "${PREBUILT_DIR}/libttsespeak.so")
if(NOT EXISTS "${PREBUILT_SO}")
  message(FATAL_ERROR
    "Missing ${PREBUILT_SO}. Run: node scripts/fetch-espeak-ng.cjs")
endif()

add_library(ttsespeak SHARED IMPORTED)
set_target_properties(ttsespeak PROPERTIES
  IMPORTED_LOCATION "${PREBUILT_SO}"
)

find_library(log-lib log)

add_library(findus_espeak SHARED espeak_jni.cpp)
target_include_directories(findus_espeak PRIVATE
  "${ESPEAK_INC_DIR}"
  "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_link_libraries(findus_espeak
  ttsespeak
  ${log-lib}
)
