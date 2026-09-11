(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const names = ['Yes', 'Maybe', 'No', 'Unassigned'];
  let snapshot, labels = {}, storageKey;
  const money = units => units === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(units / 10000);
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function bucket(row) { return names.includes(labels[row.id]) ? labels[row.id] : 'Unassigned'; }
  function sum(rows, key) {
    if (rows.some(row => row[key] === null)) return null;
    const value = rows.reduce((total, row) => total + row[key], 0);
    return Number.isSafeInteger(value) ? value : null;
  }
  function render() {
    const rows = snapshot.positions;
    $('totals').replaceChildren();
    for (const [title, key] of [['Total stake', 'stakeUnits'], ['Potential payout', 'payoutUnits'], ['Potential profit · before fees', 'profitUnits']]) {
      const card = element('div', undefined, 'card');
      card.append(element('div', title, 'label'), element('strong', money(sum(rows, key))), element('small', `${rows.length} open positions`));
      $('totals').append(card);
    }
    $('buckets').replaceChildren();
    for (const name of names) {
      const selected = rows.filter(row => bucket(row) === name);
      const card = element('div', undefined, 'card');
      card.append(element('div', `${name} · ${selected.length}`, 'bucket-title'));
      for (const [title, key] of [['Stake', 'stakeUnits'], ['Payout', 'payoutUnits'], ['Profit', 'profitUnits']]) {
        const line = element('div', undefined, 'bucket-money');
        line.append(element('span', title), element('b', money(sum(selected, key)))); card.append(line);
      }
      $('buckets').append(card);
    }
    const selected = rows.filter(row => $('filter').value === 'All' || bucket(row) === $('filter').value);
    $('empty').hidden = selected.length > 0;
    $('positions').replaceChildren();
    for (const row of selected) {
      const card = element('article', undefined, 'position'), head = element('div', undefined, 'position-head');
      const title = element('div');
      title.append(element('h3', row.title), element('div', `${row.ticker} · ${row.side} side · ${row.contracts} contracts · ${row.status}`, 'meta'));
      const label = element('label', 'Bucket '), select = element('select');
      select.setAttribute('aria-label', `Bucket for ${row.title}, ${row.side} side`);
      for (const name of names) { const option = element('option', name); option.value = name; select.append(option); }
      select.value = bucket(row);
      select.addEventListener('change', () => {
        labels[row.id] = select.value;
        try { localStorage.setItem(storageKey, JSON.stringify(labels)); }
        catch { $('status').textContent = 'Bucket changed for this session, but this browser could not save it.'; }
        render();
      });
      label.append(select); head.append(title, label); card.append(head);
      const metrics = element('div', undefined, 'metrics');
      for (const [title, key] of [['Stake', 'stakeUnits'], ['Potential payout', 'payoutUnits'], ['Profit before fees', 'profitUnits']]) {
        const metric = element('div', title); metric.append(element('strong', money(row[key]))); metrics.append(metric);
      }
      card.append(metrics);
      if (row.isParlay) {
        const details = element('details'), list = element('ul');
        details.append(element('summary', `Combination · ${row.legs.length} legs`));
        for (const leg of row.legs) list.append(element('li', `${leg.ticker} · ${leg.side}`));
        details.append(list); card.append(details);
      }
      if (!row.metadataAvailable) card.append(element('p', 'Market details could not be loaded. Payout and profit are unavailable; this position may be awaiting settlement.', 'note'));
      $('positions').append(card);
    }
  }
  async function refresh() {
    $('refresh').disabled = true;
    $('status').className = '';
    $('status').textContent = snapshot ? 'Refreshing… Previous values remain visible until the update completes.' : 'Loading your account…';
    try {
      const response = await fetch('/api/kalshi/portfolio', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(120000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Account data could not be loaded.');
      snapshot = data;
      storageKey = 'rsfs.kalshi.buckets.' + data.accountScope;
      labels = {};
      let storageNotice = '';
      try { const saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) labels = saved; }
      catch { storageNotice = ' Bucket storage is unavailable in this browser.'; }
      $('environment').textContent = `${data.environment === 'production' ? 'LIVE' : 'DEMO'} · Primary account`;
      $('balance').textContent = `Cash balance ${money(data.balanceUnits)}`;
      $('value').textContent = `Current portfolio value ${money(data.portfolioValueUnits)}`;
      $('status').textContent = `Updated ${new Date(data.asOf).toLocaleString()}. Refreshes are limited to once every 30 seconds.${storageNotice}`;
      $('content').hidden = false;
      render();
    } catch (error) {
      $('status').className = 'error';
      $('status').textContent = (snapshot ? `Update failed. Values below are from ${new Date(snapshot.asOf).toLocaleString()}. ` : '') + (error.name === 'TimeoutError' ? 'The account request timed out. Try again shortly.' : error.message);
    } finally { $('refresh').disabled = false; }
  }
  $('refresh').addEventListener('click', refresh);
  $('filter').addEventListener('change', render);
  refresh();
})();
