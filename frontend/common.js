/*
 * Shared wallet, contract and UI helpers (the same file is used by all five projects).
 * Load order in index.html: vendor/ethers.umd.min.js, contract-config.js, common.js, app.js
 *
 * Chain.read()        -> read-only contract (public RPC, no wallet needed)
 * Chain.send(label,f) -> asks the wallet to sign f(contract), waits for the block, shows toasts
 * Chain.account       -> connected wallet address or null
 * Chain.onChange(fn)  -> called when the account, wallet network or selected deployment changes
 */
(function () {
  "use strict";

  const config = window.CONTRACT_CONFIG || { abi: [], deployments: {} };
  const storageKey = `network:${config.contractName}`;
  const listeners = [];
  const state = { networkKey: null, account: null, walletChainId: null };
  let readCache = null;

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage can be blocked; the choice just isn't remembered */
    }
  }

  function pickNetwork() {
    const keys = Object.keys(config.deployments || {});
    const saved = storageGet(storageKey);
    if (saved && keys.includes(saved)) return saved;
    if (keys.includes("monadTestnet")) return "monadTestnet";
    return keys[0] || null;
  }

  function emit() {
    renderHeader();
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  }

  function requireDeployment() {
    const dep = Chain.deployment;
    if (!dep) throw new Error("The contract is not deployed yet. Run the deploy command first (see README).");
    return dep;
  }

  function setAccount(address) {
    state.account = address ? ethers.getAddress(address) : null;
  }

  async function ensureChain(dep) {
    const current = parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
    state.walletChainId = current;
    if (current === dep.chainId) return;

    const chainId = "0x" + dep.chainId.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (err) {
      const code = err && (err.code ?? (err.data && err.data.originalError && err.data.originalError.code));
      if (code !== 4902) throw err;
      // The wallet does not know this network yet, so add it.
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: dep.label,
            nativeCurrency: { name: dep.currency, symbol: dep.currency, decimals: 18 },
            rpcUrls: [dep.rpcUrl],
            ...(dep.explorer ? { blockExplorerUrls: [dep.explorer] } : {}),
          },
        ],
      });
    }
    state.walletChainId = parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
    if (state.walletChainId !== dep.chainId) {
      throw new Error(`Please switch your wallet to ${dep.label}.`);
    }
  }

  const Chain = {
    config,

    get deployment() {
      return state.networkKey ? config.deployments[state.networkKey] : null;
    },
    get account() {
      return state.account;
    },

    onChange(fn) {
      listeners.push(fn);
    },

    read() {
      const dep = requireDeployment();
      if (!readCache || readCache.key !== state.networkKey) {
        const provider = new ethers.JsonRpcProvider(dep.rpcUrl, dep.chainId, {
          staticNetwork: true,
          batchMaxCount: 1,
        });
        readCache = { key: state.networkKey, contract: new ethers.Contract(dep.address, config.abi, provider) };
      }
      return readCache.contract;
    },

    async connect() {
      if (!window.ethereum) {
        throw new Error("No wallet found. Install the MetaMask browser extension, then reload this page.");
      }
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0]);
      if (Chain.deployment) await ensureChain(Chain.deployment);
      emit();
      return state.account;
    },

    /** A contract instance that signs with the connected wallet on the right network. */
    async write() {
      const dep = requireDeployment();
      if (!state.account) await Chain.connect();
      await ensureChain(dep);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner(state.account);
      return new ethers.Contract(dep.address, config.abi, signer);
    },

    /**
     * Send a transaction with progress toasts. Returns the receipt, or null if it
     * failed or was rejected (the error is already shown to the user).
     */
    async send(label, buildTx) {
      const toast = UI.toast(`${label}: confirm in your wallet…`, "pending");
      try {
        const contract = await Chain.write();
        const tx = await buildTx(contract);
        toast.update(`${label}: waiting for confirmation…`, "pending", UI.txLink(tx.hash));
        const receipt = await tx.wait();
        toast.update(`${label}: done`, "success", UI.txLink(tx.hash));
        toast.closeAfter(6000);
        return receipt;
      } catch (err) {
        console.error(err);
        toast.update(Chain.errorMessage(err), "error");
        toast.closeAfter(9000);
        return null;
      }
    },

    /** Find a named event emitted by this contract in a transaction receipt. */
    findEvent(receipt, name) {
      const iface = new ethers.Interface(config.abi);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === name) return parsed;
        } catch {
          /* log from another contract */
        }
      }
      return null;
    },

    errorMessage(err) {
      if (!err) return "Something went wrong.";
      const nestedCode = err.info && err.info.error && err.info.error.code;
      if (err.code === "ACTION_REJECTED" || err.code === 4001 || nestedCode === 4001) {
        return "You rejected the request in your wallet.";
      }
      if (err.reason) return err.reason;
      if (err.revert && err.revert.args && err.revert.args.length) return String(err.revert.args[0]);
      const nested = (err.info && err.info.error && err.info.error.message) || (err.error && err.error.message);
      const message = String(err.shortMessage || nested || err.message || err);
      if (/insufficient funds/i.test(message)) {
        const dep = Chain.deployment;
        const faucet = dep && dep.faucet ? ` Get free testnet ${dep.currency} at ${dep.faucet}` : "";
        return `Not enough ${dep ? dep.currency : "funds"} to pay for gas.${faucet}`;
      }
      return message.replace(/^execution reverted:?\s*/i, "");
    },
  };

  // ------------------------------------------------------------------ UI helpers

  const UI = {
    $(selector, root) {
      return (root || document).querySelector(selector);
    },

    escape(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
    },

    shortAddress(address) {
      return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
    },

    sameAddress(a, b) {
      return !!a && !!b && a.toLowerCase() === b.toLowerCase();
    },

    /** Unix seconds (number or bigint) -> readable local date and time. */
    dateTime(seconds) {
      const ms = Number(seconds) * 1000;
      if (!ms) return "—";
      return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    },

    date(seconds, options) {
      const ms = Number(seconds) * 1000;
      if (!ms) return "—";
      return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium", ...(options || {}) });
    },

    explorerUrl(kind, value) {
      const dep = Chain.deployment;
      return dep && dep.explorer ? `${dep.explorer}/${kind}/${value}` : null;
    },

    txLink(hash) {
      return UI.explorerUrl("tx", hash);
    },

    /** Short address, linked to the explorer when there is one. */
    addressHtml(address) {
      const url = UI.explorerUrl("address", address);
      const text = `<code class="addr" title="${UI.escape(address)}">${UI.escape(UI.shortAddress(address))}</code>`;
      return url ? `<a href="${url}" target="_blank" rel="noopener">${text}</a>` : text;
    },

    /** Contracts limit text by UTF-8 bytes, which is more than the character count for non-English text. */
    byteLength(text) {
      return new TextEncoder().encode(text).length;
    },

    /** Live "used / max" counter under a text field; the element #<fieldId>Counter shows it. */
    bindCounter(field, maxBytes) {
      const counter = document.getElementById(`${field.id}Counter`);
      const update = () => {
        const used = UI.byteLength(field.value.trim());
        field.setCustomValidity(used > maxBytes ? `Too long: ${used} of ${maxBytes} bytes` : "");
        if (counter) {
          counter.textContent = `${used} / ${maxBytes}`;
          counter.classList.toggle("over", used > maxBytes);
        }
      };
      field.addEventListener("input", update);
      field.form && field.form.addEventListener("reset", () => setTimeout(update));
      update();
      return update;
    },

    setBusy(button, busy, busyLabel) {
      if (!button) return;
      if (busy) {
        button.dataset.label = button.textContent;
        button.textContent = busyLabel || "Working…";
        button.disabled = true;
      } else {
        button.textContent = button.dataset.label || button.textContent;
        button.disabled = false;
      }
    },

    toast(message, type) {
      let box = document.getElementById("toasts");
      if (!box) {
        box = document.createElement("div");
        box.id = "toasts";
        box.setAttribute("aria-live", "polite");
        document.body.appendChild(box);
      }
      const el = document.createElement("div");
      box.appendChild(el);
      let timer = null;
      const handle = {
        update(text, kind, link) {
          el.className = `toast toast-${kind || "info"}`;
          el.innerHTML =
            `<span>${UI.escape(text)}</span>` +
            (link ? ` <a href="${link}" target="_blank" rel="noopener">View transaction</a>` : "") +
            `<button class="toast-close" aria-label="Dismiss">×</button>`;
          el.querySelector(".toast-close").onclick = handle.close;
        },
        closeAfter(ms) {
          clearTimeout(timer);
          timer = setTimeout(handle.close, ms);
        },
        close() {
          clearTimeout(timer);
          el.remove();
        },
      };
      handle.update(message, type);
      if (type === "success" || type === "info") handle.closeAfter(5000);
      return handle;
    },

    copy(text) {
      navigator.clipboard.writeText(text).then(
        () => UI.toast("Copied", "info"),
        () => UI.toast("Could not copy - select the text and copy it manually", "error")
      );
    },
  };

  // ------------------------------------------------------------------ header

  function renderHeader() {
    const dep = Chain.deployment;
    const btn = UI.$("#connectBtn");
    const badge = UI.$("#networkBadge");
    const select = UI.$("#networkSelect");
    const banner = UI.$("#notDeployed");
    const info = UI.$("#contractInfo");

    if (banner) banner.hidden = !!dep;

    if (select) {
      const keys = Object.keys(config.deployments || {});
      select.hidden = keys.length < 2;
      select.innerHTML = keys
        .map((k) => `<option value="${k}" ${k === state.networkKey ? "selected" : ""}>${UI.escape(config.deployments[k].label)}</option>`)
        .join("");
    }

    if (badge) {
      if (!dep) {
        badge.textContent = "Not deployed";
        badge.className = "chip chip-muted";
      } else if (state.account && state.walletChainId !== null && state.walletChainId !== dep.chainId) {
        badge.textContent = `Wrong network`;
        badge.title = `Your wallet is on chain ${state.walletChainId}. This app uses ${dep.label}.`;
        badge.className = "chip chip-warning";
      } else {
        badge.textContent = dep.label;
        badge.title = `Chain ID ${dep.chainId}`;
        badge.className = "chip chip-ok";
      }
    }

    if (btn) {
      btn.textContent = state.account ? UI.shortAddress(state.account) : "Connect wallet";
      btn.title = state.account || "Connect MetaMask";
      btn.classList.toggle("btn-connected", !!state.account);
    }

    if (info) {
      if (dep) {
        const url = UI.explorerUrl("address", dep.address);
        const addr = `<code>${UI.escape(dep.address)}</code>`;
        info.innerHTML = `Contract on ${UI.escape(dep.label)}: ${url ? `<a href="${url}" target="_blank" rel="noopener">${addr}</a>` : addr}`;
      } else {
        info.textContent = "";
      }
    }
  }

  async function init() {
    state.networkKey = pickNetwork();

    const btn = UI.$("#connectBtn");
    if (btn) {
      btn.addEventListener("click", async () => {
        try {
          await Chain.connect();
        } catch (err) {
          UI.toast(Chain.errorMessage(err), "error").closeAfter(8000);
        }
      });
    }

    const select = UI.$("#networkSelect");
    if (select) {
      select.addEventListener("change", () => {
        state.networkKey = select.value;
        storageSet(storageKey, select.value);
        emit();
      });
    }

    if (window.ethereum) {
      if (window.ethereum.on) {
        window.ethereum.on("accountsChanged", (accounts) => {
          setAccount(accounts && accounts[0]);
          emit();
        });
        window.ethereum.on("chainChanged", (chainId) => {
          state.walletChainId = parseInt(chainId, 16);
          emit();
        });
      }
      // Silently restore a connection the user already approved earlier.
      try {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        setAccount(accounts && accounts[0]);
        state.walletChainId = parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
      } catch {
        /* wallet locked or unavailable */
      }
    }
    emit();
  }

  window.Chain = Chain;
  window.UI = UI;
  document.addEventListener("DOMContentLoaded", init);
})();
