/**
 * Modal Manager for Poké-Engine Modern RPG HUD
 * Coordinates opening, closing, active state tracking, ESC key listening,
 * and strict game state synchronization (State Isolation).
 */
(function (global) {
    "use strict";

    const ModalManager = function (game) {
        this.game = game;
        this.activeModal = null; // Currently open modal ID: "character" | "inventory" | "equipment" | "pokemon" | "map" | "settings"
        this._previousState = null;
        this._registeredModals = {};
        this._backdropEl = null;

        this.init();
    };

    ModalManager.prototype.init = function () {
        this.setupBackdrop();
        this.setupKeyboardShortcuts();
    };

    ModalManager.prototype.setupBackdrop = function () {
        let backdrop = document.getElementById("rpg-modal-backdrop");
        if (!backdrop) {
            backdrop = document.createElement("div");
            backdrop.id = "rpg-modal-backdrop";
            backdrop.className = "rpg-modal-backdrop";

            // Click outside container to close modal
            backdrop.addEventListener("click", (e) => {
                if (e.target === backdrop) {
                    this.closeActiveModal();
                }
            });

            const root = document.getElementById("modern-hud-root");
            if (root) {
                root.appendChild(backdrop);
            }
        }
        this._backdropEl = backdrop;
    };

    ModalManager.prototype.setupKeyboardShortcuts = function () {
        document.addEventListener("keydown", (e) => {
            // ESC key (27)
            if (e.keyCode === 27) {
                if (this.activeModal) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeActiveModal();
                }
            }
        }, true);
    };

    ModalManager.prototype.registerModal = function (id, controller) {
        this._registeredModals[id] = controller;
    };

    /**
     * Check if HUD menu is allowed to open
     * STRICT REQUIREMENT: Only allow opening when game.state === "NORMAL"
     */
    ModalManager.prototype.canOpenModal = function () {
        if (!this.game) return false;
        // Never allow opening menu while in DIALOGUE or TRANSITION
        if (this.game.state !== "NORMAL") {
            return false;
        }
        // If player is in the middle of a walk step, wait until step completes
        if (this.game.player && this.game.player.walkInProgress) {
            return false;
        }
        return true;
    };

    /**
     * Open a modal by ID
     */
    ModalManager.prototype.openModal = function (modalId) {
        // If the requested modal is already open, toggle it closed
        if (this.activeModal === modalId) {
            this.closeActiveModal();
            return;
        }

        // If another modal is already open, switch to the new modal cleanly without changing game state
        if (this.activeModal) {
            this.hideModalContent(this.activeModal);
            this.showModalContent(modalId);
            this.activeModal = modalId;
            this.updateToolbarState();
            return;
        }

        // Verify game state before entering MENU state
        if (!this.canOpenModal()) {
            return;
        }

        // 1. Save previous state (STRICT: Do not overwrite if not NORMAL)
        this._previousState = this.game.state;

        // 2. Set game state to "MENU" and halt player
        this.game.state = "MENU";
        if (this.game.player) {
            this.game.player.stop = true;
        }

        // 3. Clear keyboard input buffer to prevent walk queue upon close
        if (this.game.key && this.game.key._pressed) {
            this.game.key._pressed = {};
        }

        // 4. Show backdrop and mount content
        if (this._backdropEl) {
            this._backdropEl.classList.add("open");
        }
        this.showModalContent(modalId);
        this.activeModal = modalId;
        this.updateToolbarState();
    };

    /**
     * Close the currently open modal
     */
    ModalManager.prototype.closeActiveModal = function () {
        if (!this.activeModal) return;

        const closingModal = this.activeModal;
        this.hideModalContent(closingModal);
        this.activeModal = null;

        if (this._backdropEl) {
            this._backdropEl.classList.remove("open");
        }

        // Restore game state
        if (this.game) {
            // Restore only valid state (fall back to NORMAL)
            const restoreState = (this._previousState === "NORMAL") ? "NORMAL" : "NORMAL";
            this.game.state = restoreState;
            this._previousState = null;

            if (this.game.player) {
                this.game.player.stop = false;
            }

            // Clear keyboard buffer again upon return
            if (this.game.key && this.game.key._pressed) {
                this.game.key._pressed = {};
            }
        }

        this.updateToolbarState();
    };

    ModalManager.prototype.showModalContent = function (modalId) {
        if (!this._backdropEl) return;
        this._backdropEl.innerHTML = "";

        const controller = this._registeredModals[modalId];
        if (controller && typeof controller.render === "function") {
            const contentEl = controller.render(() => this.closeActiveModal());
            if (contentEl) {
                this._backdropEl.appendChild(contentEl);
            }
        }
    };

    ModalManager.prototype.hideModalContent = function (modalId) {
        const controller = this._registeredModals[modalId];
        if (controller && typeof controller.onClose === "function") {
            controller.onClose();
        }
        if (this._backdropEl) {
            this._backdropEl.innerHTML = "";
        }
    };

    ModalManager.prototype.updateToolbarState = function () {
        const buttons = document.querySelectorAll(".rpg-toolbar-btn");
        buttons.forEach((btn) => {
            const target = btn.getAttribute("data-modal-target");
            if (target === this.activeModal) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });
    };

    ModalManager.prototype.showToast = function (message, duration) {
        let toast = document.getElementById("rpg-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "rpg-toast";
            toast.className = "rpg-toast";
            const root = document.getElementById("modern-hud-root");
            if (root) root.appendChild(toast);
        }

        toast.textContent = message || "";
        toast.classList.add("show");

        if (this._toastTimer) clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.remove("show");
            this._toastTimer = null;
        }, duration || 2400);
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = ModalManager;
    } else {
        global.PokeModalManager = ModalManager;
    }
})(typeof window !== "undefined" ? window : global);
