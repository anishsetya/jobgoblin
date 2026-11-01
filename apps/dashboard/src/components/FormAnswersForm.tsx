// The Form answers screen's content: loads the profile, then shows the editor. Used by the setup wizard
// (step 6) and by Profile's "Form answers" tab.
import { FormAnswersEditor } from "./FormAnswersEditor";
import { ProfileGate } from "./ProfileGate";

type FormAnswersFormProps = {
  saveLabel: string;
  onSaved?: () => void;
};

export function FormAnswersForm({ saveLabel, onSaved }: FormAnswersFormProps) {
  return (
    <ProfileGate>
      {(profileResponse) => <FormAnswersEditor profileResponse={profileResponse} saveLabel={saveLabel} onSaved={onSaved} />}
    </ProfileGate>
  );
}
