cmake_minimum_required(VERSION 3.10)
project(kylin_notify LANGUAGES CXX)

# Optional native build. See docs/KYLIN_SDK.md. The default notification path
# (bridge/notify_bridge.py) needs none of this and is architecture-independent.

find_package(Qt5 COMPONENTS Widgets REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(KYSDKNOTIFICATION_PKG REQUIRED kysdk-notification)

add_executable(kylin_notify kylin_notify.cpp)

target_include_directories(kylin_notify PRIVATE
  ${Qt5Widgets_INCLUDE_DIRS}
  ${KYSDKNOTIFICATION_PKG_INCLUDE_DIRS}
)
target_compile_options(kylin_notify PRIVATE ${KYSDKNOTIFICATION_PKG_CFLAGS_OTHER})
target_link_libraries(kylin_notify
  Qt5::Widgets
  ${KYSDKNOTIFICATION_PKG_LIBRARIES}
)
target_link_directories(kylin_notify PRIVATE ${KYSDKNOTIFICATION_PKG_LIBRARY_DIRS})

install(TARGETS kylin_notify RUNTIME DESTINATION bin)
