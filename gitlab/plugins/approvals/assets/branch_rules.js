/* DSOaaS approvals plugin: approval rules on Settings > Repository > Branch rules.
 *
 *   data-mode="details"  branch rule page (?branch=<name>): a "Merge request
 *                        approvals" section listing the rules that target this
 *                        branch rule, with add/edit/delete (editor.js, the same
 *                        editor as Settings > Merge requests);
 *   data-mode="list"     branch rules list: "N approval rules" under each rule.
 *
 * GitLab CE renders these pages with a compiled Vue app that has no slot for us
 * (EE fills its own), so the section is added next to CE's own and re-added if
 * Vue re-renders. If CE's markers are gone (a future GitLab), nothing is shown;
 * enforcement doesn't depend on this script. */
(function () {
  'use strict';

  var script = document.querySelector('script[data-dsoaas-branch-rules]');
  if (!script) return;

  var A = window.DsoaasApprovals;
  var mode = script.dataset.mode;
  var project = script.dataset.project;
  var apiBase = script.dataset.apiRoot + '/projects/' + encodeURIComponent(project);
  var mrSettingsPath = script.dataset.mrSettingsPath;
  var ALL_BRANCHES = 'All branches';
  var ALL_PROTECTED = 'All protected branches';

  function getJSON(path) {
    return fetch(apiBase + path, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function globRegex(pattern) {
    var out = '';
    var depth = 0;
    for (var i = 0; i < pattern.length; i += 1) {
      var c = pattern[i];
      if (c === '*') out += '.*';
      else if (c === '?') out += '.';
      else if (c === '{') { out += '(?:'; depth += 1; }
      else if (c === '}' && depth) { out += ')'; depth -= 1; }
      else if (c === ',' && depth) out += '|';
      else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
    try { return new RegExp('^' + out + '$'); } catch (e) { return null; }
  }

  function targetNames(rule) {
    return (rule.protected_branches || []).map(function (b) { return b.name; }).concat(rule.branches || []);
  }

  // Rules this branch rule owns: they target exactly it.
  function targetsThis(rule, branch) {
    if (branch === ALL_PROTECTED) return rule.applies_to_all_protected_branches;
    if (rule.applies_to_all_protected_branches) return false;
    var names = targetNames(rule);
    if (branch === ALL_BRANCHES) return names.length === 0;
    return names.indexOf(branch) !== -1;
  }

  // Broader rules that also apply to merge requests into this branch.
  function alsoApplies(rule, branch) {
    if (branch === ALL_BRANCHES || branch === ALL_PROTECTED || targetsThis(rule, branch)) return false;
    if (rule.applies_to_all_protected_branches) return true; // a branch rule's branches are protected
    var names = targetNames(rule);
    if (!names.length) return true;
    if (branch.indexOf('*') !== -1) return false;
    return names.some(function (p) { var re = globRegex(p); return re && re.test(branch); });
  }

  /* ---------------------------------------------------------------- list */

  function initList() {
    var rules = null;

    function countFor(name) {
      return rules.filter(function (r) { return targetsThis(r, name); }).length;
    }

    function apply() {
      if (!rules) return;
      document.querySelectorAll('[data-testid="branch-content"][data-qa-branch-name]').forEach(function (row) {
        var item = row.parentElement;
        if (!item) return;
        var n = countFor(row.dataset.qaBranchName);
        var mine = item.querySelector(':scope > .dsoaas-br-count');
        if (!n) { if (mine) mine.remove(); return; }
        var text = n + (n === 1 ? ' approval rule' : ' approval rules');
        if (mine && mine.textContent === text && item.lastElementChild === mine) return;
        if (!mine) {
          mine = A.h('ul', { class: 'dsoaas-br-count gl-mb-0 gl-mt-2 gl-pl-6 gl-text-subtle' }, [A.h('li', {})]);
        }
        mine.firstChild.textContent = text;
        if (item.lastElementChild !== mine) item.appendChild(mine);
      });
    }

    getJSON('/approval_rules').then(function (data) {
      rules = data;
      apply();
      var queued = false;
      new MutationObserver(function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () { queued = false; apply(); });
      }).observe(document.body, { childList: true, subtree: true });
    }).catch(function () { /* rules unavailable: CE list unchanged */ });
  }

  /* ------------------------------------------------------------- details */

  function initDetails() {
    var branch = new URLSearchParams(window.location.search).get('branch');
    if (!branch) return;

    var mountData = document.getElementById('js-branch-rules');
    var canEdit = mountData ? mountData.dataset.canAdminProtectedBranches === 'true' : null;
    var state = { rules: [], protectedBranches: [], error: null };
    var section = null;
    var ctx = {
      apiBase: apiBase,
      protectedBranches: [],
      onSaved: function (message) { load(message); },
    };

    function resolveCanEdit() {
      if (canEdit !== null) return Promise.resolve(canEdit);
      return getJSON('').then(function (p) {
        var perms = p.permissions || {};
        var level = Math.max((perms.project_access || {}).access_level || 0, (perms.group_access || {}).access_level || 0);
        if (level >= 40) return true;
        return fetch(script.dataset.apiRoot + '/user', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : {}; })
          .then(function (u) { return u.is_admin === true; });
      }).then(function (value) { canEdit = value; return value; })
        .catch(function () { canEdit = false; return false; });
    }

    // CE's own sections, used as anchors and as the style to copy.
    function anchors() {
      var target = document.querySelector('[data-testid="rule-target-card"]');
      if (!target) return null;
      var merge = document.querySelector('[data-testid="allowed-to-merge-content"]');
      var protectSection = null;
      if (merge) {
        protectSection = merge;
        while (protectSection.parentElement && protectSection.parentElement !== target.parentElement) {
          protectSection = protectSection.parentElement;
        }
        if (protectSection.parentElement !== target.parentElement) protectSection = null;
      }
      return { container: target.parentElement, target: target, protectSection: protectSection };
    }

    function avatar(u) {
      return A.h('a', { href: u.web_url, class: 'gl-inline-flex gl-items-center gl-gap-2 gl-text-default',
        title: '@' + u.username }, [
        A.h('img', { src: u.avatar_url, alt: '', class: 'gl-avatar gl-avatar-s24 gl-avatar-circle', width: '24',
          height: '24', loading: 'lazy' }),
        A.h('span', { text: u.name }),
      ]);
    }

    function approversCell(rule) {
      if (!rule.users.length && !rule.groups.length) {
        return A.h('span', { class: 'gl-text-subtle', text: 'Any eligible user (Developer role or higher)' });
      }
      var wrap = A.h('div', {}, [
        A.h('div', { class: 'gl-flex gl-flex-wrap gl-items-center gl-gap-3' },
          rule.users.map(avatar).concat(rule.groups.map(function (g) {
            return A.h('span', { class: 'gl-badge badge badge-pill badge-neutral', text: g.full_path });
          }))),
      ]);
      if (rule.require_all) {
        wrap.appendChild(A.h('div', { class: 'gl-text-sm gl-text-subtle gl-mt-2', text: 'Every listed person must approve' }));
      }
      return wrap;
    }

    function requiredCell(rule) {
      return rule.require_all ? 'All (' + rule.approvals_required + ')' : String(rule.approvals_required);
    }

    function actionsCell(rule) {
      if (!canEdit) return null;
      return A.h('td', { class: 'gl-text-right', 'data-label': 'Actions' }, [
        A.h('div', { class: 'gl-inline-flex gl-gap-2' }, [
          A.button('Edit', 'default btn-sm', function () { A.openRuleModal(ctx, rule); }),
          A.button('Delete', 'danger btn-sm btn-danger-secondary', function () { A.openDeleteModal(ctx, rule); }),
        ]),
      ]);
    }

    function table(rules, withTarget) {
      var head = ['Rule', 'Approvers'];
      if (withTarget) head.push('Target branch');
      head.push('Approvals required');
      return A.h('table', { class: 'table b-table gl-table b-table-stacked-md gl-mb-0 dsoaas-br-table', role: 'table' }, [
        A.h('thead', {}, [A.h('tr', {}, head.map(function (t) { return A.h('th', { text: t }); })
          .concat(canEdit ? [A.h('th', {}, [A.h('span', { class: 'gl-sr-only', text: 'Actions' })])] : []))]),
        A.h('tbody', {}, rules.map(function (rule) {
          return A.h('tr', { 'data-testid': 'dsoaas-branch-approval-rule', 'data-rule-id': String(rule.id) }, [
            A.h('td', { 'data-label': 'Rule' }, [
              A.h('div', { class: 'gl-font-bold', text: rule.name }),
              rule.file_paths.length ? A.h('div', { class: 'gl-text-sm gl-text-subtle gl-mt-1',
                text: 'When these paths change: ' + rule.file_paths.join(', ') }) : null,
            ]),
            A.h('td', { 'data-label': 'Approvers' }, [approversCell(rule)]),
            withTarget ? A.h('td', { 'data-label': 'Target branch', text: A.describeTarget(rule) }) : null,
            A.h('td', { 'data-label': 'Approvals required', text: requiredCell(rule) }),
            actionsCell(rule),
          ]);
        })),
      ]);
    }

    function card(title, count, description, actions, body) {
      return A.h('section', { class: 'crud gl-border gl-flex gl-flex-col gl-rounded-xl gl-border-transparent gl-bg-strong gl-px-2 gl-pb-2 contrast-more:gl-border-strong gl-mt-5' }, [
        A.h('header', { class: 'crud-header gl-relative gl-flex gl-flex-wrap gl-justify-between gl-gap-x-5 gl-gap-y-2 gl-rounded-t-lg gl-py-0 gl-pl-3 gl-pr-2' }, [
          A.h('div', { class: 'gl-flex gl-grow gl-flex-col gl-self-center gl-py-3' }, [
            A.h('h2', { class: 'gl-mx-0 gl-my-2 gl-inline-flex gl-items-center gl-gap-3 gl-text-base gl-font-bold gl-leading-normal gl-text-heading' }, [
              title,
              count !== null ? A.h('span', { class: 'crud-count gl-inline-flex gl-items-center gl-gap-2 gl-self-start gl-text-sm gl-font-normal gl-text-subtle', text: String(count) }) : null,
            ]),
            description ? A.h('p', { class: '!gl-mb-0 !gl-text-sm !gl-leading-normal !gl-text-subtle' }, description) : null,
          ]),
          A.h('div', { class: 'gl-my-3 gl-flex gl-items-start gl-gap-3' }, actions || []),
        ]),
        A.h('div', { class: 'crud-body gl-grow gl-rounded-lg gl-bg-default gl-p-3' }, body),
      ]);
    }

    function build(flash) {
      var own = state.rules.filter(function (r) { return targetsThis(r, branch); });
      var others = state.rules.filter(function (r) { return alsoApplies(r, branch); });
      var predefinedDefaults = branch === ALL_PROTECTED ? { applies_to_all_protected_branches: true }
        : (branch === ALL_BRANCHES ? {} : { branches: [branch] });
      var target = branch === ALL_BRANCHES ? 'any branch'
        : (branch === ALL_PROTECTED ? 'any protected branch' : A.h('code', { text: branch }));

      var a = anchors();
      var heading = a && a.protectSection ? a.protectSection.querySelector('h2, h3') : null;
      var el = A.h('section', { class: (a && a.protectSection ? a.protectSection.className : '') + ' gl-mt-5 dsoaas-br-approvals',
        'data-testid': 'dsoaas-branch-approvals' });
      el.appendChild(A.h(heading ? heading.tagName.toLowerCase() : 'h2', {
        class: heading ? heading.className : 'gl-heading-2', text: 'Merge request approvals' }));
      el.appendChild(A.h('p', { class: 'gl-text-subtle gl-mb-3' }, [
        'Approvals required before merging into ', target,
        '. These are the same rules as in ',
        mrSettingsPath ? A.h('a', { href: mrSettingsPath, text: 'Settings > Merge requests' }) : 'Settings > Merge requests',
        '.',
      ]));

      if (flash) {
        A.showFlash(el, flash);
        el.appendChild(el.firstChild); // after the heading and description
      }
      if (state.error) {
        el.appendChild(A.h('div', { class: 'gl-alert gl-alert-danger', role: 'alert' }, [
          A.h('div', { class: 'gl-alert-content' }, [A.h('div', { class: 'gl-alert-body',
            text: 'Approval rules are unavailable: ' + state.error }) ]),
        ]));
        return el;
      }

      var addBtn = canEdit ? A.button('Add approval rule', 'default btn-sm', function () {
        A.openRuleModal(ctx, null, predefinedDefaults);
      }, 'js-dsoaas-branch-add-rule') : null;
      el.appendChild(card('Approval rules', own.length, null, addBtn ? [addBtn] : [],
        own.length ? [table(own, false)]
          : [A.h('span', { class: 'gl-text-subtle', text: 'No approval rules target this branch rule.' })]));

      if (others.length) {
        el.appendChild(card('Also applies to this branch', others.length,
          ['Rules with a broader target branch. Edit them here or in Settings > Merge requests.'],
          [], [table(others, true)]));
      }
      return el;
    }

    function place() {
      var a = anchors();
      if (!a || !section) return;
      var after = a.protectSection || a.target;
      if (section.parentElement === a.container && section.previousElementSibling === after) return;
      a.container.insertBefore(section, after.nextSibling);
    }

    function render(flash) {
      var next = build(flash);
      if (section && section.parentElement) section.parentElement.replaceChild(next, section);
      section = next;
      place();
    }

    function load(flash) {
      return Promise.all([
        getJSON('/approval_rules'),
        getJSON('/protected_branches?per_page=100').catch(function () { return []; }),
      ]).then(function (res) {
        state.rules = res[0];
        state.error = null;
        ctx.protectedBranches = res[1].map(function (b) { return { id: b.id, name: b.name }; });
      }).catch(function (e) {
        state.error = e.message;
      }).then(function () { render(flash); });
    }

    resolveCanEdit().then(function () { return load(); }).then(function () {
      var queued = false;
      new MutationObserver(function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () { queued = false; place(); });
      }).observe(document.body, { childList: true, subtree: true });
    });
  }

  if (!A) return;
  if (mode === 'details') initDetails();
  else if (mode === 'list') initList();
})();
