/* DSOaaS approvals plugin: the approval rule editor, shared by
 * Settings > Merge requests (settings.js) and Settings > Repository > Branch rules
 * (branch_rules.js), so both pages edit the same rules the same way.
 * Vanilla JS, no build step. Every change goes through the EE-compatible REST API
 * (session cookie + CSRF token). */
(function () {
  'use strict';

  if (window.DsoaasApprovals) return;

  var FLASH_KEY = 'dsoaas-approvals-flash';
  var uid = 0;

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    [].concat(children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function csrf() {
    return (document.querySelector('meta[name="csrf-token"]') || {}).content;
  }

  function api(apiBase, method, path, body) {
    return fetch(apiBase + path, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf(), Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var msg = data && (data.message || data.error);
          if (msg && typeof msg === 'object') msg = JSON.stringify(msg);
          var err = new Error(msg || 'Request failed (' + res.status + ')');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function search(path) {
    return fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; });
  }

  function reloadWith(message) {
    try { sessionStorage.setItem(FLASH_KEY, message); } catch (e) { /* ignore */ }
    window.location.reload();
  }

  function takeFlash() {
    try {
      var pending = sessionStorage.getItem(FLASH_KEY);
      if (pending) sessionStorage.removeItem(FLASH_KEY);
      return pending;
    } catch (e) { return null; }
  }

  function showFlash(container, message, variant) {
    var alert = h('div', { class: 'gl-alert gl-alert-' + (variant || 'success') + ' gl-mb-5', role: 'status' }, [
      h('div', { class: 'gl-alert-content' }, [h('div', { class: 'gl-alert-body', text: message })]),
    ]);
    container.insertBefore(alert, container.firstChild);
    setTimeout(function () { alert.remove(); }, 6000);
  }

  /* ---------- token picker (users, groups, branch patterns, paths) ---------- */

  function picker(opts) {
    // opts: { label, help, placeholder, items: [{key,label,avatar}], search(term)->Promise<items>, freeText }
    var items = opts.items.slice();
    var tokens = h('div', { class: 'dsoaas-picker-tokens' });
    var input = h('input', { class: 'form-control gl-form-input', type: 'text', placeholder: opts.placeholder || '',
      'aria-label': opts.label, autocomplete: 'off' });
    var list = h('ul', { class: 'dsoaas-picker-results', role: 'listbox', hidden: true });
    var timer;

    function render() {
      tokens.innerHTML = '';
      items.forEach(function (item, i) {
        tokens.appendChild(h('span', { class: 'dsoaas-token' }, [
          item.avatar ? h('img', { src: item.avatar, alt: '' }) : null,
          item.label,
          h('button', { type: 'button', 'aria-label': 'Remove ' + item.label, text: '×',
            onclick: function () { items.splice(i, 1); render(); } }),
        ]));
      });
    }

    function add(item) {
      if (!items.some(function (x) { return String(x.key) === String(item.key); })) items.push(item);
      input.value = '';
      list.hidden = true;
      render();
      input.focus();
    }

    function showResults(results) {
      list.innerHTML = '';
      var fresh = results.filter(function (r) {
        return !items.some(function (x) { return String(x.key) === String(r.key); });
      });
      if (!fresh.length) { list.hidden = true; return; }
      fresh.slice(0, 20).forEach(function (r) {
        list.appendChild(h('li', { role: 'option', onmousedown: function (e) { e.preventDefault(); add(r); } }, [
          r.avatar ? h('img', { src: r.avatar, alt: '' }) : null,
          h('span', {}, [r.label, r.sub ? h('span', { class: 'dsoaas-muted', text: ' ' + r.sub }) : null]),
        ]));
      });
      list.hidden = false;
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      var term = input.value.trim();
      if (!term || !opts.search) { list.hidden = true; return; }
      timer = setTimeout(function () { opts.search(term).then(showResults); }, 250);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var term = input.value.trim();
        var first = list.querySelector('li');
        if (!list.hidden && first) first.dispatchEvent(new MouseEvent('mousedown'));
        else if (term && opts.freeText) add({ key: term, label: term });
      } else if (e.key === 'Escape') {
        list.hidden = true;
      }
    });
    input.addEventListener('blur', function () { setTimeout(function () { list.hidden = true; }, 150); });

    render();
    var wrap = h('div', { class: 'dsoaas-form-group' }, [
      h('span', { class: 'dsoaas-label', text: opts.label }),
      h('div', { class: 'dsoaas-picker' }, [tokens, input, list]),
      opts.help ? h('div', { class: 'dsoaas-help', text: opts.help }) : null,
    ]);
    return { el: wrap, values: function () { return items.map(function (x) { return x.key; }); } };
  }

  /* ---------- modal ---------- */

  function modal(title, body, actions) {
    var backdrop = h('div', { class: 'modal-backdrop fade show' });
    var closeBtn = h('button', { type: 'button', class: 'btn btn-default btn-sm gl-button btn-default-tertiary btn-icon',
      'aria-label': 'Close', text: '×' });
    var dialog = h('div', { class: 'modal fade show gl-modal dsoaas-modal', role: 'dialog', 'aria-modal': 'true',
      'aria-label': title, tabindex: '-1', style: 'display:block' }, [
      h('div', { class: 'modal-dialog modal-md' }, [
        h('div', { class: 'modal-content' }, [
          h('header', { class: 'modal-header' }, [h('h2', { class: 'modal-title', text: title }), closeBtn]),
          h('div', { class: 'modal-body' }, body),
          h('footer', { class: 'modal-footer' }, actions),
        ]),
      ]),
    ]);
    function close() { dialog.remove(); backdrop.remove(); document.body.classList.remove('modal-open'); }
    closeBtn.addEventListener('click', close);
    dialog.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    dialog.addEventListener('mousedown', function (e) { if (e.target === dialog) close(); });
    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);
    document.body.classList.add('modal-open');
    setTimeout(function () { var f = dialog.querySelector('input'); if (f) f.focus(); }, 0);
    return { close: close, el: dialog };
  }

  function button(label, variant, onclick, extra) {
    var attrs = { type: 'button', class: 'btn gl-button btn-' + (variant || 'default') + (extra ? ' ' + extra : ''),
      onclick: onclick };
    return h('button', attrs, [h('span', { class: 'gl-button-text', text: label })]);
  }

  function radio(name, value, label, checked) {
    var id = name + '-' + value;
    return h('div', { class: 'gl-form-radio custom-control custom-radio' }, [
      h('input', { type: 'radio', class: 'custom-control-input', name: name, id: id, value: value, checked: checked }),
      h('label', { class: 'custom-control-label', for: id, text: label }),
    ]);
  }

  /* ---------- target branches ---------- */

  // Every target name of a rule: linked branch rules (current names) + patterns.
  function targetNames(rule) {
    return (rule.protected_branches || []).map(function (b) { return b.name; }).concat(rule.branches || []);
  }

  function describeTarget(rule) {
    if (rule.applies_to_all_protected_branches) return 'All protected branches';
    var names = targetNames(rule);
    return names.length ? names.join(', ') : 'All branches';
  }

  /* ---------- rule editor ---------- */

  // ctx: { apiBase, protectedBranches: [{id, name}], onSaved(message) }
  // defaults (new rules only): { branches: [...] } or { applies_to_all_protected_branches: true }
  function openRuleModal(ctx, rule, defaults) {
    var editing = !!rule;
    var n = ++uid;
    rule = rule || Object.assign({ name: '', approvals_required: 1, users: [], groups: [], branches: [],
      protected_branches: [], file_paths: [], require_all: false, applies_to_all_protected_branches: false },
    defaults || {});
    var protectedBranches = ctx.protectedBranches || [];

    function searchUsers(term) {
      return search(ctx.apiBase + '/users?per_page=20&search=' + encodeURIComponent(term)).then(function (users) {
        return users.map(function (u) {
          return { key: u.id, label: u.name, sub: '@' + u.username, avatar: u.avatar_url };
        });
      });
    }

    function searchGroups(term) {
      var groupsUrl = ctx.apiBase.replace(/\/projects\/[^/]+$/, '/groups');
      return search(groupsUrl + '?per_page=20&search=' + encodeURIComponent(term)).then(function (groups) {
        return groups.map(function (g) { return { key: g.id, label: g.full_path, avatar: g.avatar_url }; });
      });
    }

    function searchBranches(term) {
      var t = term.toLowerCase();
      return Promise.resolve(protectedBranches.filter(function (b) {
        return b.name.toLowerCase().indexOf(t) !== -1;
      }).map(function (b) { return { key: b.name, label: b.name, sub: 'branch rule' }; }));
    }

    var error = h('div', { class: 'dsoaas-field-error', role: 'alert', hidden: true });
    var nameId = 'dsoaas-rule-name-' + n;
    var requiredId = 'dsoaas-rule-required-' + n;
    var name = h('input', { class: 'form-control gl-form-input', id: nameId, value: rule.name, maxlength: '200' });
    var required = h('input', { class: 'form-control gl-form-input gl-w-20', type: 'number', min: '0', max: '100',
      id: requiredId, value: String(rule.require_all ? 1 : rule.approvals_required) });

    var users = picker({ label: 'Users', placeholder: 'Search users',
      items: rule.users.map(function (u) { return { key: u.id, label: u.name, avatar: u.avatar_url }; }),
      search: searchUsers });
    var groups = picker({ label: 'Groups', placeholder: 'Search groups',
      help: 'Members of these groups (including inherited members) are eligible.',
      items: rule.groups.map(function (g) { return { key: g.id, label: g.full_path }; }), search: searchGroups });

    var names = targetNames(rule);
    var branchMode = rule.applies_to_all_protected_branches ? 'protected' : (names.length ? 'specific' : 'all');
    var branches = picker({ label: 'Branches', placeholder: 'Branch rule, or a pattern like release/* then Enter',
      help: 'Picking a branch rule links to it: renaming the branch rule keeps this approval rule on it.',
      items: names.map(function (b) { return { key: b, label: b }; }), search: searchBranches, freeText: true });
    var paths = picker({ label: 'Only when these files change (optional)',
      placeholder: 'e.g. infra/** or **/Dockerfile, then Enter',
      help: 'Leave empty to apply the rule to every merge request.',
      items: rule.file_paths.map(function (p) { return { key: p, label: p }; }), freeText: true });

    var modeName = 'dsoaas-mode-' + n;
    var branchName = 'dsoaas-branches-' + n;
    var modeGroup = h('div', { class: 'dsoaas-form-group' }, [
      h('span', { class: 'dsoaas-label', text: 'Who approves' }),
      radio(modeName, 'any', 'Any of the approvers below (a number of approvals)', !rule.require_all),
      radio(modeName, 'all', 'Every one of the users below must approve', rule.require_all),
    ]);
    var requiredGroup = h('div', { class: 'dsoaas-form-group' }, [
      h('label', { for: requiredId, text: 'Approvals required' }), required,
      h('div', { class: 'dsoaas-help', text: 'With no users or groups, anyone with the Developer role or higher can approve.' }),
    ]);
    var branchGroup = h('div', { class: 'dsoaas-form-group' }, [
      h('span', { class: 'dsoaas-label', text: 'Target branch' }),
      radio(branchName, 'all', 'All branches', branchMode === 'all'),
      radio(branchName, 'protected', 'All protected branches', branchMode === 'protected'),
      radio(branchName, 'specific', 'Specific branches', branchMode === 'specific'),
    ]);

    function sync() {
      var all = modeGroup.querySelector('input:checked').value === 'all';
      requiredGroup.hidden = all;
      groups.el.hidden = all;
      branches.el.hidden = branchGroup.querySelector('input:checked').value !== 'specific';
    }
    modeGroup.addEventListener('change', sync);
    branchGroup.addEventListener('change', sync);

    var saveBtn;
    var m = modal(editing ? 'Edit approval rule' : 'Add approval rule', [
      error,
      h('div', { class: 'dsoaas-form-group' }, [h('label', { for: nameId, text: 'Rule name' }), name]),
      modeGroup, requiredGroup, users.el, groups.el, branchGroup, branches.el, paths.el,
    ], [
      button('Cancel', 'default', function () { m.close(); }),
      (saveBtn = button(editing ? 'Save changes' : 'Add approval rule', 'confirm', function () {
        var all = modeGroup.querySelector('input:checked').value === 'all';
        var bmode = branchGroup.querySelector('input:checked').value;
        var payload = {
          name: name.value.trim(),
          require_all: all,
          user_ids: users.values(),
          group_ids: all ? [] : groups.values(),
          applies_to_all_protected_branches: bmode === 'protected',
          // Names of branch rules are linked by the server; protected_branch_ids
          // is sent empty so the target list is replaced as a whole.
          protected_branch_ids: [],
          branches: bmode === 'specific' ? branches.values() : [],
          file_paths: paths.values(),
        };
        if (!all) payload.approvals_required = parseInt(required.value, 10) || 0;
        if (bmode === 'specific' && !payload.branches.length) {
          error.textContent = 'Add at least one branch, or choose All branches.';
          error.hidden = false;
          return;
        }
        saveBtn.disabled = true;
        error.hidden = true;
        api(ctx.apiBase, editing ? 'PUT' : 'POST', '/approval_rules' + (editing ? '/' + rule.id : ''), payload)
          .then(function () {
            m.close();
            ctx.onSaved(editing ? 'Approval rule updated.' : 'Approval rule added.');
          })
          .catch(function (e) { error.textContent = e.message; error.hidden = false; saveBtn.disabled = false; });
      })),
    ]);
    sync();
  }

  function openDeleteModal(ctx, rule) {
    var error = h('div', { class: 'dsoaas-field-error', role: 'alert', hidden: true });
    var names = targetNames(rule);
    var m = modal('Delete approval rule?', [
      h('p', {}, ['Delete ', h('strong', { text: rule.name }),
        '? Merge requests stop needing its approvals right away.']),
      names.length > 1 ? h('p', { class: 'gl-text-subtle', text: 'It is removed from every branch it targets: ' +
        names.join(', ') + '.' }) : null,
      error,
    ], [
      button('Cancel', 'default', function () { m.close(); }),
      button('Delete approval rule', 'danger', function () {
        api(ctx.apiBase, 'DELETE', '/approval_rules/' + rule.id)
          .then(function () { m.close(); ctx.onSaved('Approval rule deleted.'); })
          .catch(function (e) { error.textContent = e.message; error.hidden = false; });
      }),
    ]);
  }

  window.DsoaasApprovals = {
    h: h,
    api: api,
    button: button,
    reloadWith: reloadWith,
    takeFlash: takeFlash,
    showFlash: showFlash,
    targetNames: targetNames,
    describeTarget: describeTarget,
    openRuleModal: openRuleModal,
    openDeleteModal: openDeleteModal,
  };
})();
