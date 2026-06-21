ROOT := $(CURDIR)
THIRD_PARTY_DIR := $(ROOT)/third-party
BUILD_DIR := $(ROOT)/build/emscripten
PREFIX := $(BUILD_DIR)/prefix

TCL_SRC_DIR := $(THIRD_PARTY_DIR)/tcl
TK_SRC_DIR := $(THIRD_PARTY_DIR)/tk
TCL_BUILD_DIR := $(BUILD_DIR)/tcl
TK_BUILD_DIR := $(BUILD_DIR)/tk

HOST_TRIPLET ?= wasm32-unknown-emscripten
BUILD_TRIPLET ?= $(shell cc -dumpmachine 2>/dev/null || echo unknown-unknown-unknown)

EMCONFIGURE ?= emconfigure
EMMAKE ?= emmake
EM_CACHE ?= $(BUILD_DIR)/em-cache
CONFIGURE_TOOLS_DIR := $(ROOT)/tools/emscripten-configure-tools
NINJA ?= ninja
NINJA_FILE ?= build.ninja
NPROC ?= $(shell nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)
NINJAFLAGS ?= -j$(NPROC)

export EM_CACHE

COMMON_CONFIGURE_OPTS := \
	--host=$(HOST_TRIPLET) \
	--build=$(BUILD_TRIPLET) \
	--prefix=$(PREFIX) \
	--disable-shared \
	--disable-load \
	--disable-threads \
	--disable-rpath \
	--disable-corefoundation

COMMON_CONFIGURE_CACHE := \
	tcl_cv_sys_version=Emscripten \
	ac_cv_func_strtoul=yes \
	tcl_cv_strtoul_unbroken=ok

TCL_CONFIGURE_OPTS ?= \
	$(COMMON_CONFIGURE_OPTS) \
	--disable-dll-unloading \
	--with-tzdata=no \
	$(COMMON_CONFIGURE_CACHE)
TK_CONFIGURE_OPTS ?= \
	$(COMMON_CONFIGURE_OPTS) \
	--with-tcl=$(TCL_BUILD_DIR) \
	--without-x \
	--disable-xft \
	--disable-xss \
	$(COMMON_CONFIGURE_CACHE)

.PHONY: all ninja tcl tk browser configure-tcl configure-tk compile-commands compile_commands typecheck-js clean distclean

all: ninja

ninja:
	$(NINJA) -f $(NINJA_FILE) $(NINJAFLAGS)

tcl:
	$(NINJA) -f $(NINJA_FILE) $(NINJAFLAGS) tcl

tk:
	$(NINJA) -f $(NINJA_FILE) $(NINJAFLAGS) tk

browser:
	$(NINJA) -f $(NINJA_FILE) $(NINJAFLAGS) browser

configure-tcl:
	$(NINJA) -f $(NINJA_FILE) $(NINJAFLAGS) configure-tcl

configure-tk:
	$(NINJA) -f $(NINJA_FILE) $(NINJAFLAGS) configure-tk

compile-commands compile_commands:
	$(NINJA) -f $(NINJA_FILE) $(NINJAFLAGS) compile_commands

typecheck-js:
	$(NINJA) -f $(NINJA_FILE) $(NINJAFLAGS) typecheck_js

$(TCL_BUILD_DIR)/Makefile:
	mkdir -p $(TCL_BUILD_DIR) $(PREFIX) $(EM_CACHE)
	cd $(TCL_BUILD_DIR) && PATH="$(CONFIGURE_TOOLS_DIR):$$PATH" $(EMCONFIGURE) $(TCL_SRC_DIR)/unix/configure $(TCL_CONFIGURE_OPTS)

$(TK_BUILD_DIR)/Makefile: $(TCL_BUILD_DIR)/Makefile
	mkdir -p $(TK_BUILD_DIR) $(PREFIX) $(EM_CACHE)
	cd $(TK_BUILD_DIR) && PATH="$(CONFIGURE_TOOLS_DIR):$$PATH" $(EMCONFIGURE) $(TK_SRC_DIR)/unix/configure $(TK_CONFIGURE_OPTS)

clean:
	-$(MAKE) -C $(TCL_BUILD_DIR) clean
	-$(MAKE) -C $(TK_BUILD_DIR) clean
	-$(NINJA) -f $(NINJA_FILE) -t clean

distclean:
	rm -rf $(BUILD_DIR)
