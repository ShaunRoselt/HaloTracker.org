UPDATE steam_friend_sync
SET sync_after = sync_after - 23 * 60 * 60 * 1000
WHERE sync_after > unixepoch() * 1000 + 60 * 60 * 1000;
