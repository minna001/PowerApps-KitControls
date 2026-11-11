// Command-bar handlers for Kate's decisions on the Submission form.
// Each one calls the nbpra_AdminDecision custom API; the server enforces every rule.
var NBPRA = window.NBPRA || {};

(function () {
  function decide(formContext, action, label, needsReason) {
    if (formContext.data.getIsDirty()) {
      Xrm.Navigation.openAlertDialog({ text: "Save or discard your changes before recording a decision." });
      return;
    }
    var comment = window.prompt(label + (needsReason ? "\n\nReason (required):" : "\n\nComment (optional):"), "");
    if (comment === null) return; // canceled
    var request = {
      SubmissionId: formContext.data.entity.getId().replace(/[{}]/g, ""),
      Action: action,
      Comment: comment,
      Channel: "App",
      getMetadata: function () {
        var s = { typeName: "Edm.String", structuralProperty: 1 };
        return {
          boundParameter: null,
          operationType: 0,
          operationName: "nbpra_AdminDecision",
          parameterTypes: { SubmissionId: s, Action: s, Comment: s, Channel: s },
        };
      },
    };
    Xrm.Utility.showProgressIndicator("Recording decision");
    Xrm.WebApi.online
      .execute(request)
      .then(function (response) {
        return response.json();
      })
      .then(function (result) {
        Xrm.Utility.closeProgressIndicator();
        if (result.Outcome === "accepted") {
          formContext.ui.setFormNotification(result.Message, "INFO", "nbpra_decision");
          window.setTimeout(function () {
            formContext.ui.clearFormNotification("nbpra_decision");
          }, 8000);
          return formContext.data.refresh(false);
        }
        return Xrm.Navigation.openAlertDialog({ title: "Decision not recorded", text: result.Message });
      })
      .catch(function (error) {
        Xrm.Utility.closeProgressIndicator();
        Xrm.Navigation.openAlertDialog({ title: "Decision not recorded", text: error.message });
      });
  }

  NBPRA.approveOnboarding = function (formContext) {
    decide(formContext, "approveOnboarding", "Approve onboarding and unlock the checklist", false);
  };
  NBPRA.denyOnboarding = function (formContext) {
    decide(formContext, "denyOnboarding", "Deny onboarding", true);
  };
  NBPRA.authorize = function (formContext) {
    decide(formContext, "authorize", "Authorize committee attendance", false);
  };
  NBPRA.returnFinal = function (formContext) {
    decide(formContext, "returnFinal", "Return the final package for changes", true);
  };
  NBPRA.rejectFinal = function (formContext) {
    decide(formContext, "rejectFinal", "Reject committee admission", true);
  };
})();

window.NBPRA = NBPRA;
