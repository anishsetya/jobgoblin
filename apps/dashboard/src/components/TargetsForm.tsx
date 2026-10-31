// The Targets screen's content: loads the profile, then shows the editor.
// Used by the setup wizard (step 7) and by Profile's Targets tab.
import { ProfileGate } from "./ProfileGate";
import { TargetsEditor } from "./TargetsEditor";

type TargetsFormProps = {
  saveLabel: string;
  onSaved?: () => void;
};

export function TargetsForm({ saveLabel, onSaved }: TargetsFormProps) {
  return (
    <ProfileGate>
      {(profileResponse) => <TargetsEditor profileResponse={profileResponse} saveLabel={saveLabel} onSaved={onSaved} />}
    </ProfileGate>
  );
}
