// F-8: one rule for who sees an athlete's body weight (roster weights, weigh-ins, testing-day weights).
// Staff need body-data access (can 'body.view': head coach/admins, trainers, perms.body_data). The athlete and
// their parents see it only when the head coach turns on family_sees_bodyweight. Height is not covered here.
export function seesBodyWeight(core, viewer, playerId) {
  if (!viewer) return false;
  const pid = Number(playerId);
  if (core.isStaff(viewer)) {
    return core.can(viewer, 'body.view') && !!core.db.get(`SELECT 1 FROM users WHERE id=? AND program_id=? AND role='player'`, pid, viewer.program_id);
  }
  return !!core.settings(viewer.program_id).family_sees_bodyweight && core.linkedPlayers(viewer).includes(pid);
}
