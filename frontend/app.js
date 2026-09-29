(function () {
  "use strict";

  const { $, escape } = UI;
  const MAX_DESCRIPTION = 100;
  const CATEGORIES = ["Food", "Travel", "Shopping", "Bills", "Education", "Health", "Entertainment", "Other"];

  let expenses = [];
  let total = 0n;

  // ------------------------------------------------------------------ money (stored in paise)

  /** "250.75" -> 25075n, or null when the text is not a valid amount. */
  function toPaise(text) {
    const value = text.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  }

  /** 25075n -> "₹250.75" with Indian digit grouping. */
  function rupees(paise) {
    const value = BigInt(paise);
    const whole = value / 100n;
    const fraction = (value % 100n).toString().padStart(2, "0");
    return `₹${whole.toLocaleString("en-IN")}.${fraction}`;
  }

  function todayLocal() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  const asMe = () => ({ from: Chain.account });

  // ------------------------------------------------------------------ data

  async function load() {
    if (!Chain.deployment || !Chain.account) {
      expenses = [];
      total = 0n;
      render();
      return;
    }
    try {
      const c = Chain.read();
      const [list, sum] = await Promise.all([c.getExpenses(asMe()), c.getTotal(asMe())]);
      expenses = list.map((e) => ({
        id: Number(e.id),
        description: e.description,
        category: e.category,
        amount: e.amount,
        date: Number(e.date),
        recordedAt: Number(e.recordedAt),
      }));
      total = sum;
    } catch (err) {
      UI.toast(`Could not load expenses: ${Chain.errorMessage(err)}`, "error").closeAfter(8000);
    }
    render();
  }

  // ------------------------------------------------------------------ rendering

  function byCategory() {
    const map = new Map();
    for (const e of expenses) {
      const entry = map.get(e.category) || { category: e.category, amount: 0n, count: 0 };
      entry.amount += e.amount;
      entry.count += 1;
      map.set(e.category, entry);
    }
    return [...map.values()].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  }

  function render() {
    const connected = !!Chain.account && !!Chain.deployment;
    const now = new Date();
    const monthTotal = expenses
      .filter((e) => {
        const d = new Date(e.date * 1000);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((sum, e) => sum + e.amount, 0n);
    const groups = byCategory();

    $("#statTotal").textContent = connected ? rupees(total) : "–";
    $("#statMonth").textContent = connected ? rupees(monthTotal) : "–";
    $("#statMonthName").textContent = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    $("#statCount").textContent = connected ? expenses.length : "–";
    $("#statTop").textContent = groups.length ? groups[0].category : "–";
    $("#statTopNote").textContent = groups.length ? rupees(groups[0].amount) : "";

    renderFilter(groups);
    renderBreakdown(groups, connected);
    renderHistory(connected);
  }

  function renderFilter(groups) {
    const select = $("#filter");
    const previous = select.value;
    select.innerHTML =
      `<option value="">All categories</option>` +
      groups.map((g) => `<option value="${escape(g.category)}">${escape(g.category)}</option>`).join("");
    if (groups.some((g) => g.category === previous)) select.value = previous;
  }

  function renderBreakdown(groups, connected) {
    const out = $("#breakdown");
    if (!connected || !groups.length) {
      out.innerHTML = `<div class="empty">${connected ? "Add an expense to see where your money goes." : "Connect your wallet to see your spending."}</div>`;
      return;
    }
    const max = groups[0].amount;
    out.innerHTML = `<div class="bars" role="list">${groups
      .map((g) => {
        const width = Number((g.amount * 10000n) / max) / 100; // bar length relative to the largest category
        const share = total > 0n ? Number((g.amount * 1000n) / total) / 10 : 0;
        const label = `${g.category}: ${rupees(g.amount)} (${share}% of total) across ${g.count} expense${g.count === 1 ? "" : "s"}`;
        return `<div class="bar-row" role="listitem" title="${escape(label)}" aria-label="${escape(label)}">
            <span class="bar-name">${escape(g.category)}</span>
            <span><span class="bar-mark" style="display:block;width:${width}%"></span></span>
            <span class="bar-value">${rupees(g.amount)} <span class="muted">${Math.round(share)}%</span></span>
          </div>`;
      })
      .join("")}</div>`;
  }

  function renderHistory(connected) {
    const out = $("#history");
    if (!Chain.deployment) {
      out.innerHTML = `<div class="empty">Deploy the contract to begin.</div>`;
      return;
    }
    if (!connected) {
      out.innerHTML = `<div class="empty">Your ledger belongs to your wallet.<br /><br />
        <button class="btn" type="button" id="connectInline">Connect wallet</button></div>`;
      return;
    }
    if (!expenses.length) {
      out.innerHTML = `<div class="empty">No expenses recorded yet.</div>`;
      return;
    }

    const category = $("#filter").value;
    const shown = expenses
      .filter((e) => !category || e.category === category)
      .sort((a, b) => b.date - a.date || b.id - a.id);
    const shownTotal = shown.reduce((sum, e) => sum + e.amount, 0n);

    const rows = shown
      .map(
        (e) => `<tr>
          <td title="Recorded on-chain ${escape(UI.dateTime(e.recordedAt))}">${UI.date(e.date)}</td>
          <td class="desc">${escape(e.description)}</td>
          <td><span class="chip chip-accent chip-plain">${escape(e.category)}</span></td>
          <td class="num">${rupees(e.amount)}</td>
        </tr>`
      )
      .join("");
    out.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">${category ? `${escape(category)} total` : "Total"} (${shown.length} expense${shown.length === 1 ? "" : "s"})</td><td class="num">${rupees(shownTotal)}</td></tr></tfoot>
      </table></div>`;
  }

  // ------------------------------------------------------------------ actions

  async function add(event) {
    event.preventDefault();
    const description = $("#description").value.trim();
    const category = $("#category").value;
    const amount = toPaise($("#amount").value);
    if (amount === null || amount === 0n) {
      UI.toast("Enter an amount greater than zero, with at most 2 decimals.", "error").closeAfter(6000);
      return;
    }
    const day = $("#date").value;
    let date = 0; // 0 = "now" (the contract uses the block time)
    if (day !== todayLocal()) {
      const [y, m, d] = day.split("-").map(Number);
      date = Math.floor(new Date(y, m - 1, d, 12).getTime() / 1000); // midday avoids time-zone edge cases
    }

    const button = $("#addBtn");
    UI.setBusy(button, true, "Saving…");
    const receipt = await Chain.send(`Add ${rupees(amount)} for ${description}`, (c) => c.addExpense(description, category, amount, date));
    UI.setBusy(button, false);
    if (!receipt) return;
    $("#description").value = "";
    $("#amount").value = "";
    $("#description").dispatchEvent(new Event("input"));
    await load();
  }

  // ------------------------------------------------------------------ wiring

  document.addEventListener("DOMContentLoaded", () => {
    $("#category").innerHTML = CATEGORIES.map((c) => `<option>${c}</option>`).join("");
    $("#date").value = todayLocal();
    $("#date").max = todayLocal();
    UI.bindCounter($("#description"), MAX_DESCRIPTION);

    $("#expenseForm").addEventListener("submit", add);
    $("#filter").addEventListener("change", () => renderHistory(!!Chain.account && !!Chain.deployment));
    $("#refreshBtn").addEventListener("click", load);
    $("#history").addEventListener("click", async (e) => {
      if (!e.target.closest("#connectInline")) return;
      try {
        await Chain.connect();
      } catch (err) {
        UI.toast(Chain.errorMessage(err), "error").closeAfter(8000);
      }
    });
  });

  Chain.onChange(load);
})();
