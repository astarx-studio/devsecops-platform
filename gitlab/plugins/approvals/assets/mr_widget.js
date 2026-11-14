/* DSOaaS approvals plugin: merge request widget.
 *
 * CE's approvals widget only knows "Approval is optional". This script reads the
 * EE-compatible approval_state endpoint and, like GitLab EE:
 *   - replaces the summary with "Requires 2 approvals from Leads, Sign-off." etc.;
 *   - adds an "Approval rules" table: approvers needed, progress, who approved;
 *   - offers "Request review from approvers".
 * It hooks onto CE markers (.js-mr-approvals, approvals-summary-content). If they
 * ever disappear, it does nothing; merging stays blocked by the native check. */
(function () {
  'use strict';

  var script = document.currentScript || document.querySelector('script[data-dsoaas-approvals]');
  if (!script) return;

  var apiRoot = script.dataset.apiRoot;
  var projectEnc = encodeURIComponent(script.dataset.project);
  var iid = script.dataset.iid;
  var mrApi = apiRoot + '/projects/' + projectEnc + '/merge_requests/' + iid;
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content;
  var currentUserId = window.gon && window.gon.current_user_id;
  var ROOT_ID = 'dsoaas-mr-approval-rules';
  var OPTIONAL_TEXT = 'Approval is optional';

  var state = null;
  var expanded = null; // null = default (expanded while approvals are missing)
  var fetching = false;
  var refetchTimer = null;
  var lastSummaryText = null;

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

  function request(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error((data && data.message) || 'Request failed (' + res.status + ')');
        return data;
      });
    });
  }

  function names(list) {
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  function summaryText(s) {
    if (s.state === 'invalid') return 'Approval rules can’t be used: ' + s.error;
    var left = s.rules.filter(function (r) { return !r.approved; });
    if (!left.length) return 'All approval rules are satisfied.';
    var blocked = left.filter(function (r) { return r.unsatisfiable; });
    if (blocked.length) return 'Approval rule ' + names(blocked.map(function (r) { return r.name; })) + ' can’t be met.';
    var count = left.reduce(function (n, r) { return n + r.approvals_left; }, 0);
    return 'Requires ' + count + ' approval' + (count === 1 ? '' : 's') + ' from ' +
      names(left.map(function (r) { return r.name; })) + '.';
  }

  function avatar(user, approved) {
    return h('a', { href: user.web_url, class: 'has-tooltip' + (approved ? ' dsoaas-approved' : ''),
      title: user.name + ' (@' + user.username + ')' + (approved ? ' – approved' : ''),
      'aria-label': user.name + (approved ? ', approved' : '') },
      [h('img', { src: user.avatar_url, alt: '', loading: 'lazy' })]);
  }

  function approversCell(rule) {
    var approvedIds = rule.approved_by.map(function (u) { return u.id; });
    var shown = rule.users.slice();
    rule.eligible_approvers.forEach(function (u) {
      if (!shown.some(function (x) { return x.id === u.id; })) shown.push(u);
    });
    rule.approved_by.forEach(function (u) {
      if (!shown.some(function (x) { return x.id === u.id; })) shown.push(u);
    });

    var parts = [];
    if (rule.any_approver) {
      parts.push(h('span', { class: 'dsoaas-muted', text: 'Any eligible user' }));
    }
    var avatars = h('div', { class: 'dsoaas-avatars' }, shown.slice(0, 20).map(function (u) {
      return avatar(u, approvedIds.indexOf(u.id) !== -1);
    }));
    if (shown.length > 20) avatars.appendChild(h('span', { class: 'dsoaas-muted', text: '+' + (shown.length - 20) }));
    if (!rule.any_approver || rule.approved_by.length) parts.push(avatars);
    if (rule.groups.length) {
      parts.push(h('div', { class: 'dsoaas-muted gl-mt-1',
        text: 'Groups: ' + rule.groups.map(function (g) { return g.full_path; }).join(', ') }));
    }
    if (rule.require_all) parts.push(h('div', { class: 'dsoaas-muted gl-mt-1', text: 'Each person must approve' }));
    return parts;
  }

  function branchText(rule) {
    if (rule.applies_to_all_protected_branches) return 'All protected branches';
    if (!rule.branches.length) return 'All branches';
    return rule.branches.join(', ');
  }

  function statusCell(rule) {
    var given = rule.approved_by.length;
    if (rule.unsatisfiable) {
      return h('span', { class: 'dsoaas-rule-status-error', text: 'Can’t be met: ' + rule.unsatisfiable });
    }
    if (rule.approved) {
      return h('span', { class: 'dsoaas-rule-status-ok', text: given + ' of ' + rule.approvals_required + ' ✓' });
    }
    return h('span', { class: 'dsoaas-rule-status-pending', text: given + ' of ' + rule.approvals_required });
  }

  // Listed users of unmet rules who haven't approved and aren't reviewers yet.
  function missingReviewers(s, reviewerIds) {
    var ids = [];
    s.rules.forEach(function (rule) {
      if (rule.approved) return;
      var approved = rule.approved_by.map(function (u) { return u.id; });
      rule.users.forEach(function (u) {
        if (approved.indexOf(u.id) === -1 && reviewerIds.indexOf(u.id) === -1 && ids.indexOf(u.id) === -1 &&
            u.id !== currentUserId) {
          ids.push(u.id);
        }
      });
    });
    return ids;
  }

  function requestReview(btn, message) {
    btn.disabled = true;
    request('GET', mrApi)
      .then(function (mr) {
        var reviewerIds = (mr.reviewers || []).map(function (u) { return u.id; });
        var add = missingReviewers(state, reviewerIds);
        if (!add.length) {
          message.textContent = 'All required approvers are already reviewers.';
          btn.disabled = false;
          return null;
        }
        return request('PUT', mrApi, { reviewer_ids: reviewerIds.concat(add) }).then(function () {
          message.textContent = 'Review requested. Reloading…';
          window.location.reload();
        });
      })
      .catch(function (e) {
        message.textContent = e.message;
        btn.disabled = false;
      });
  }

  function renderBlock(s) {
    var open = expanded === null ? s.state !== 'passed' : expanded;
    var toggle = h('button', { type: 'button', class: 'btn btn-default btn-sm gl-button btn-default-tertiary',
      'aria-expanded': String(open), 'aria-controls': ROOT_ID + '-table',
      onclick: function () { expanded = !open; mount(); } },
      [h('span', { class: 'gl-button-text', text: (open ? 'Hide' : 'Show') + ' approval rules (' + s.rules.length + ')' })]);

    var header = h('div', { class: 'gl-flex gl-flex-wrap gl-items-center gl-gap-3' }, [toggle]);
    if (currentUserId && s.state !== 'passed' && missingReviewers(s, []).length) {
      var message = h('span', { class: 'dsoaas-muted gl-text-sm', role: 'status' });
      var btn = h('button', { type: 'button', class: 'btn btn-default btn-sm gl-button',
        onclick: function () { requestReview(btn, message); } },
        [h('span', { class: 'gl-button-text', text: 'Request review from approvers' })]);
      header.appendChild(btn);
      header.appendChild(message);
    }

    var children = [header];
    if (open) {
      var rows = s.rules.map(function (rule) {
        return h('tr', { 'data-rule-id': rule.id || '' }, [
          h('td', { 'data-label': 'Rule' }, [
            h('span', { class: 'gl-font-bold', text: rule.name }),
            rule.rule_type === 'file' ? h('div', { class: 'dsoaas-muted gl-text-sm', text: '.gitlab/approvals.yml' }) : null,
            rule.file_paths.length ? h('div', { class: 'dsoaas-muted gl-text-sm',
              text: 'When changed: ' + rule.file_paths.join(', ') }) : null,
          ]),
          h('td', { 'data-label': 'Target branch', text: branchText(rule) }),
          h('td', { 'data-label': 'Approvers' }, approversCell(rule)),
          h('td', { 'data-label': 'Approvals' }, [statusCell(rule)]),
        ]);
      });
      children.push(h('table', { id: ROOT_ID + '-table', 'aria-label': 'Approval rules' }, [
        h('thead', {}, [h('tr', {}, ['Rule', 'Target branch', 'Approvers', 'Approvals'].map(function (t) {
          return h('th', { scope: 'col', text: t });
        }))]),
        h('tbody', {}, rows),
      ]));
    }
    return h('div', { id: ROOT_ID, class: 'dsoaas-mr-rules gl-px-5 gl-pb-4', 'data-testid': 'dsoaas-mr-approval-rules' },
      children);
  }

  function patchSummary(container, s) {
    var summary = container.querySelector('[data-testid="approvals-summary-content"]');
    if (!summary) return;
    var span = summary.querySelector('span');
    if (!span) return;
    var text = summaryText(s);
    var showsOptional = span.textContent.trim() === OPTIONAL_TEXT;
    // Replace CE's "optional" text, and keep our text if Vue re-rendered it back.
    if (showsOptional || span.textContent.trim() === lastSummaryText || s.state !== 'passed') {
      if (span.textContent !== text) span.textContent = text;
      span.classList.remove('gl-text-subtle');
      span.classList.add('gl-font-bold');
      if (s.state === 'invalid' || s.rules.some(function (r) { return r.unsatisfiable; })) {
        span.classList.add('gl-text-danger');
      }
      lastSummaryText = text;
      var help = summary.querySelector('a[href*="approvals"]');
      if (help && showsOptional) help.hidden = true;
    }
  }

  function mount() {
    if (!state || state.state === 'inactive' || !state.rules) return;
    var container = document.querySelector('.js-mr-approvals');
    if (!container) return;
    patchSummary(container, state);
    var existing = document.getElementById(ROOT_ID);
    var block = renderBlock(state);
    if (existing && existing.parentNode === container) container.replaceChild(block, existing);
    else {
      if (existing) existing.remove();
      container.appendChild(block);
    }
  }

  function load() {
    if (fetching) return;
    fetching = true;
    request('GET', mrApi + '/approval_state')
      .then(function (s) { state = s; mount(); })
      .catch(function () { /* no access, or plugin unavailable: leave CE's widget alone */ })
      .finally(function () { fetching = false; });
  }

  function scheduleRefetch() {
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(load, 700);
  }

  // CE re-renders the approvals block on approve/revoke: re-fetch then. Our own
  // block changing must not trigger a loop, so ignore mutations inside it.
  function isOurs(node) {
    return node && node.nodeType === 1 && node.id === ROOT_ID;
  }

  function ownMutation(m) {
    if (m.type === 'childList') {
      var nodes = [].slice.call(m.addedNodes).concat([].slice.call(m.removedNodes));
      if (nodes.length && nodes.every(isOurs)) return true;
    }
    // Our summary rewrite (text node replaced or edited to our own text).
    var el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    return !!(el && lastSummaryText && el.closest('[data-testid="approvals-summary-content"]') &&
      el.textContent.trim() === lastSummaryText);
  }

  var observer = new MutationObserver(function (mutations) {
    var relevant = mutations.some(function (m) {
      if (ownMutation(m)) return false;
      var node = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!node || node.closest('#' + ROOT_ID)) return false;
      if (node.closest('.js-mr-approvals')) return true;
      // The approvals block itself appearing (first render or Vue re-creating it).
      return [].slice.call(m.addedNodes).some(function (n) {
        return n.nodeType === 1 && (n.matches('.js-mr-approvals') || n.querySelector('.js-mr-approvals'));
      });
    });
    if (!relevant) return;
    var container = document.querySelector('.js-mr-approvals');
    if (container && !document.getElementById(ROOT_ID) && state) mount();
    scheduleRefetch();
  });

  function start() {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
