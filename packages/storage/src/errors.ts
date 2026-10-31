// The errors this package throws on purpose. Each has a stable `code`, so the server can turn it into
// an ApiError { code, message, action } without matching on message text.
// Spec: ARCHITECTURE.md section 7 and the code style guide ("Errors").

export class StorageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

// The database was written by a newer Jobgoblin. Opening it with older code could damage it,
// so openDatabase refuses. The message is shown to the person exactly as written (spec: "Upgrades").
export class DatabaseTooNewError extends StorageError {
  constructor() {
    super("database-too-new", "Update Jobgoblin to open your data.");
  }
}

// db.transaction() was called while another transaction was open. SQLite cannot nest BEGIN, and
// quietly joining the outer transaction would hide a mistake, so this is an error in our own code.
export class NestedTransactionError extends StorageError {
  constructor() {
    super(
      "nested-transaction",
      "A transaction was opened inside another one. Call the table functions directly instead of nesting db.transaction().",
    );
  }
}

// updateApplicationStatus found the application in a different status than the caller expected, which
// means someone else moved it first (or the screen was out of date). Nothing was changed.
export class StaleStatusError extends StorageError {
  constructor(
    readonly applicationId: string,
    readonly expected: string,
    readonly actual: string | null,
  ) {
    super(
      "stale-status",
      `Application ${applicationId} is ${actual === null ? "missing" : `"${actual}"`}, not "${expected}". Nothing was changed.`,
    );
  }
}

// A row the caller asked to change does not exist. Used where "nothing changed" would hide a bug.
export class RecordNotFoundError extends StorageError {
  constructor(what: string, id: string) {
    super("not-found", `No ${what} with id ${id}.`);
  }
}

// An approved resume file already exists with different bytes. Approved files are written once and never
// replaced (tech spec "Rules"), because the fingerprint the person approved must keep describing the file.
export class ApprovedFileConflictError extends StorageError {
  constructor(shortId: string) {
    super(
      "approved-file-conflict",
      `Resumes/${shortId}.pdf already exists with different content. Approved resume files are never replaced.`,
    );
  }
}

// A path that was supposed to stay inside the person's folder does not.
export class PathOutsideFolderError extends StorageError {
  constructor(attempted: string) {
    super("path-outside-folder", `"${attempted}" is outside your Jobgoblin folder.`);
  }
}

// restore() was given something that is not the name of a backup file. This stops "..\\evil" and
// other paths from being used to copy an arbitrary file over the database.
export class InvalidBackupIdError extends StorageError {
  constructor(id: string) {
    super("invalid-backup-id", `"${id}" is not the name of a Jobgoblin backup.`);
  }
}

export class BackupNotFoundError extends StorageError {
  constructor(id: string) {
    super("backup-not-found", `The backup "${id}" is no longer in your Backups folder.`);
  }
}

// Backups and the tracker need the person's folder; the caller has not chosen one yet.
export class NoPersonFolderError extends StorageError {
  constructor() {
    super("no-person-folder", "Choose your Jobgoblin folder first.");
  }
}
