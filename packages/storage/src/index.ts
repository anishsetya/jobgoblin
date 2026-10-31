// The public face of @jobgoblin/storage: everything the server needs, re-exported. No logic lives here.
// Spec: ARCHITECTURE.md section 7.

// The database
export { atomically, type Database } from "./database";
export { openDatabase, DATABASE_FILE_NAME, type OpenDatabaseOptions } from "./openDatabase";
export { defaultMigrationsDir, readSchemaVersion } from "./migrations";
export { newId } from "./rows";
export {
  ApprovedFileConflictError,
  BackupNotFoundError,
  DatabaseTooNewError,
  InvalidBackupIdError,
  NestedTransactionError,
  NoPersonFolderError,
  PathOutsideFolderError,
  RecordNotFoundError,
  StaleStatusError,
  StorageError,
} from "./errors";

// Table modules, one per table group
export { getProfile, getProfileSection, saveProfileSection } from "./tables/profile";
export {
  getStoryItem,
  insertStoryItem,
  listStoryItems,
  listStoryItemsByIds,
  listStoryItemsByStatus,
  setStoryItemStatus,
  updateStoryItem,
  type StoryItemEdit,
  type StoryItemStatusChange,
} from "./tables/story";
export { getMasterResume, saveMasterResume, type MasterResume } from "./tables/masterResume";
export { insertUpload, listLatestUploads, listUploads, type Upload } from "./tables/uploads";
export { getCompany, insertCompanyIfMissing, listCompanies, setCompanyStatus } from "./tables/companies";
export {
  countUnseenJobs,
  getJob,
  insertJobIfNew,
  listJobsByDedupeKey,
  listUnseenJobs,
  markJobsSeen,
} from "./tables/jobs";
export {
  deleteFeedCacheEntriesBefore,
  getFeedCacheEntry,
  saveFeedCacheEntry,
  type FeedCacheEntry,
} from "./tables/feedCache";
export {
  countApplicationsByStatus,
  countApplicationsCreatedSince,
  getApplication,
  getApplicationByJobId,
  insertApplication,
  listApplicationsByCompany,
  listApplicationsByStatus,
  listLimitCandidates,
  updateApplicationFields,
  updateApplicationStatus,
  type ApplicationFieldChanges,
  type LimitCandidate,
  type StatusChange,
} from "./tables/applications";
export { listApplications, listFollowUpsDue, listTrackerRows, type TrackerRow } from "./tables/applicationQueries";
export { getFit, saveFit } from "./tables/fits";
export {
  findApprovedPdfForVersion,
  getApplicationResume,
  getApprovedPdf,
  getResumeVersion,
  getResumeVersionByShortId,
  insertApplicationResumeIfNew,
  insertResumeVersionIfNew,
  listApplicationResumes,
  listApprovedResumeFiles,
  markResumeApproved,
  type ApprovedPdf,
  type ApprovedResumeFile,
  type ApprovedResumeInput,
} from "./tables/resumes";
export {
  getApproval,
  getLatestApproval,
  getLiveApproval,
  insertApproval,
  listLiveApprovals,
  markApprovalUsed,
  voidApproval,
} from "./tables/approvals";
export { getSubmissionForApplication, insertSubmission } from "./tables/submissions";
export { listAnswers, replaceAnswers } from "./tables/answers";
export {
  addRunTask,
  countRunTasksByState,
  findActiveRunForApplication,
  findOldestQueuedRun,
  getNextPendingRunTask,
  getRun,
  insertRun,
  listRecentRuns,
  listRunTasks,
  listRunTasksByState,
  listRunsByStatus,
  setRunTaskState,
  updateRun,
  type RunChanges,
  type RunTaskUpdate,
} from "./tables/runs";
export {
  answerQuestion,
  getQuestion,
  hasOpenQuestion,
  insertQuestion,
  listOpenQuestions,
  listQuestionsForApplication,
} from "./tables/questions";
export { countStatusChangesSince, insertHistoryEvent, listHistoryEvents } from "./tables/historyEvents";
export { getSetting, getSettings, setSetting, setSettings } from "./tables/settings";

// The person's folder, the tracker, backups
export { createPersonFolder, type ApprovedResumeFiles, type PersonFolder } from "./personFolder";
export { fileSha256, sha256OfBytes } from "./hash";
export { formatLocalDay, formatLocalMinute } from "./localTime";
export {
  createTrackerExporter,
  TRACKER_COLUMNS,
  type TrackerExporter,
  type TrackerExporterOptions,
} from "./tracker";
export {
  createBackups,
  chooseBackupsToKeep,
  type BackupReason,
  type Backups,
  type BackupsOptions,
} from "./backups";
export { verifyApprovedFiles, type VerifyApprovedFilesReport } from "./verifyApprovedFiles";
export { realScheduler, type ReportError, type ScheduledTimer, type Scheduler } from "./scheduler";
