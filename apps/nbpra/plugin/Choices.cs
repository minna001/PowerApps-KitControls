namespace Nbpra.Plugins
{
    /// <summary>
    /// Choice values. Each is the publisher base plus the option's position in
    /// dataverse/schema.json, which is how provision.mjs numbers them.
    /// </summary>
    internal static class Choices
    {
        private const int B = 774100000;

        internal static class SubmissionStatus
        {
            public const int OnboardingDraft = B + 0, AwaitingOnboardingReview = B + 1, OnboardingDenied = B + 2, ChecklistInProgress = B + 3,
                AwaitingSignatoryApproval = B + 4, ReadyForFinalSubmission = B + 5, AwaitingFinalAdminReview = B + 6,
                FinalChangesRequested = B + 7, FinalRejected = B + 8, AuthorizedForCommittee = B + 9, Withdrawn = B + 10;

            public static string Label(int v)
            {
                string[] names =
                {
                    "Onboarding Draft", "Awaiting Onboarding Review", "Onboarding Denied", "Checklist in Progress",
                    "Awaiting Signatory Approval", "Ready for Final Submission", "Awaiting Final Admin Review",
                    "Final Changes Requested", "Final Rejected", "Authorized for Committee", "Withdrawn",
                };
                var i = v - B;
                return i >= 0 && i < names.Length ? names[i] : v.ToString();
            }
        }

        internal static class SlotRequestStatus { public const int Draft = B + 0, Pending = B + 1, Approved = B + 2, Denied = B + 3, Superseded = B + 4, Canceled = B + 5; }
        internal static class MeetingStatus { public const int Draft = B + 0, Open = B + 1, Closed = B + 2, Canceled = B + 3; }
        internal static class SlotStatus { public const int Open = B + 0, Blocked = B + 1, Closed = B + 2, Canceled = B + 3; }
        internal static class TemplateStatus { public const int Draft = B + 0, Published = B + 1, Retired = B + 2; }
        internal static class SectionStatus
        {
            public const int NotStarted = B + 0, Draft = B + 1, ReadyToSubmit = B + 2, UnderReview = B + 3, ChangesRequested = B + 4, Approved = B + 5, NotApplicable = B + 6, Superseded = B + 7;
            public static string Label(int v)
            {
                string[] names = { "Not Started", "Draft", "Ready to Submit", "Under Review", "Changes Requested", "Approved", "Not Applicable", "Superseded" };
                var i = v - B;
                return i >= 0 && i < names.Length ? names[i] : v.ToString();
            }
        }
        internal static class UploadStatus { public const int Pending = B + 0, Complete = B + 1, Failed = B + 2, Superseded = B + 3; }
        internal static class ExportType { public const int Draft = B + 0, Submitted = B + 1, CommitteeAuthorized = B + 2; }
        internal static class ExportStatus { public const int Pending = B + 0, Generated = B + 1, Failed = B + 2; }
        internal static class RevisionState { public const int Draft = B + 0, Submitted = B + 1, Approved = B + 2, Returned = B + 3, Superseded = B + 4; }
        internal static class AnswerType { public const int Text = B + 0, LongText = B + 1, Boolean = B + 2, Choice = B + 3, MultiChoice = B + 4, Number = B + 5, Currency = B + 6, Date = B + 7, Person = B + 8, File = B + 9; }
        internal static class ApprovalPurpose { public const int Onboarding = B + 0, FunctionalSection = B + 1, SignatoryPackage = B + 2, FinalCommitteeAdmission = B + 3; }
        internal static class ApprovalPolicy { public const int OneAuthorized = B + 0, FirstResponse = B + 1, AllFiveNamed = B + 2; }
        internal static class ApprovalStatus { public const int Pending = B + 0, Approved = B + 1, ChangesRequested = B + 2, Denied = B + 3, Superseded = B + 4, Canceled = B + 5; }
        internal static class AssignmentStatus { public const int Pending = B + 0, Completed = B + 1, Canceled = B + 2, Superseded = B + 3; }
        internal static class DecisionOutcome { public const int Approve = B + 0, ChangesRequested = B + 1, Deny = B + 2, Reject = B + 3; }
        internal static class Channel { public const int App = B + 0, Teams = B + 1, Email = B + 2, Flow = B + 3, System = B + 4; }
        internal static class ActorKind { public const int Human = B + 0, System = B + 1; }
        internal static class EventType { public const int Submission = B + 0, Slot = B + 1, Checklist = B + 2, Section = B + 3, ReviewRequest = B + 5, Signatory = B + 6, Invalidation = B + 7, FinalSubmission = B + 8, Admission = B + 9, Evidence = B + 4, Export = B + 12; }
    }
}
