-- owner is a reserved internal id. Public responses never include a friend's bearer code except to the owner or that friend at login.
CREATE TABLE accounts (
 id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE,
 code TEXT UNIQUE, invite TEXT UNIQUE, pw TEXT, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (id = 'owner' AND code IS NULL AND invite IS NULL AND pw IS NULL OR
        id <> 'owner' AND id <> code AND code IS NOT NULL AND invite IS NOT NULL AND pw IS NOT NULL)
);
CREATE TABLE records (
 person TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, list TEXT NOT NULL, id TEXT NOT NULL,
 item TEXT NOT NULL CHECK(json_valid(item) AND length(item)<=45000),
 updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(person,list,id)
);
-- The owner's rows in records are the shared projection. Full owner records stay in Sheets.
CREATE TABLE publications (
 person TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, list TEXT NOT NULL, id TEXT NOT NULL,
 PRIMARY KEY(person,list,id)
);
CREATE TABLE relations (
 sender TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 recipient TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 accepted INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK(sender<>recipient)
);
CREATE UNIQUE INDEX relation_pair ON relations(min(sender,recipient),max(sender,recipient));
CREATE TABLE houses (person TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, icon TEXT NOT NULL, intro TEXT NOT NULL);
CREATE TABLE habits (
 person TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL, name TEXT NOT NULL,
 icon TEXT NOT NULL, color TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(person,id)
);
CREATE TABLE habit_days (
 person TEXT NOT NULL, id TEXT NOT NULL, stamp INTEGER NOT NULL, PRIMARY KEY(person,id,stamp),
 FOREIGN KEY(person,id) REFERENCES habits(person,id) ON DELETE CASCADE
);
CREATE TABLE reports (id INTEGER PRIMARY KEY, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, name TEXT NOT NULL, text TEXT NOT NULL, ver TEXT NOT NULL, ua TEXT NOT NULL);
CREATE TABLE login_limits (person TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, failures INTEGER NOT NULL, expires INTEGER NOT NULL);
