/* DSOaaS approvals plugin: Settings > Merge requests > Merge request approvals.
 * The rule editor lives in editor.js (shared with the Branch rules page). Every
 * change goes through the EE-compatible REST API, then the page reloads. */
(function () {
  'use strict';

  var root = document.getElementById('js-dsoaas-approval-settings');
  var A = window.DsoaasApprovals;
  if (!root || !A) return;

  var rules = JSON.parse(root.dataset.rules || '[]');
  var ctx = {
    apiBase: root.dataset.apiBase,
    protectedBranches: JSON.parse(root.dataset.protectedBranches || '[]'),
    onSaved: A.reloadWith,
  };

  var pending = A.takeFlash();
  if (pending) {
    A.showFlash(root, pending);
    root.scrollIntoView({ block: 'start' });
  }

  if (root.dataset.canEdit !== 'true') return;

  function ruleById(id) {
    return rules.find(function (r) { return String(r.id) === String(id); });
  }

  root.addEventListener('click', function (e) {
    var add = e.target.closest('.js-dsoaas-add-rule');
    var edit = e.target.closest('.js-dsoaas-edit-rule');
    var del = e.target.closest('.js-dsoaas-delete-rule');
    var save = e.target.closest('.js-dsoaas-save-settings');
    if (add) A.openRuleModal(ctx, null);
    else if (edit) A.openRuleModal(ctx, ruleById(edit.dataset.ruleId));
    else if (del) A.openDeleteModal(ctx, ruleById(del.dataset.ruleId));
    else if (save) {
      var body = {};
      root.querySelectorAll('.js-dsoaas-setting').forEach(function (cb) {
        body[cb.dataset.setting] = cb.dataset.inverted === 'true' ? !cb.checked : cb.checked;
      });
      save.disabled = true;
      A.api(ctx.apiBase, 'POST', '/approvals', body)
        .then(function () { save.disabled = false; A.showFlash(root, 'Approval settings saved.'); })
        .catch(function (err) { save.disabled = false; A.showFlash(root, err.message, 'danger'); });
    }
  });
})();
