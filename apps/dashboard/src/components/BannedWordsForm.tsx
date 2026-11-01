// The Banned words tab's content: loads the profile, then shows the editor.
import { BannedWordsEditor } from "./BannedWordsEditor";
import { ProfileGate } from "./ProfileGate";

export function BannedWordsForm() {
  return (
    <ProfileGate>
      {(profileResponse) => <BannedWordsEditor initialWords={profileResponse.profile.rules.bannedTerms} />}
    </ProfileGate>
  );
}
