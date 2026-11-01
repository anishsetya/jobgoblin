// Profile: the person's facts, kept true and current. Four tabs: Your story, Form answers, Targets and
// Banned words. The open tab is part of the address (/profile/answers), so a reload keeps it.
// Spec: PRD "Screens: Profile" and P2-P5, ARCHITECTURE.md section 12 (/profile/:tab).
import { useTranslation } from "react-i18next";
import { BannedWordsForm } from "@/components/BannedWordsForm";
import { FormAnswersForm } from "@/components/FormAnswersForm";
import { TargetsForm } from "@/components/TargetsForm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { usePageTitle } from "@/lib/pageTitle";
import { StoryTab } from "./profile/StoryTab";
import { PROFILE_TABS, parseProfileTab, type ProfileTab } from "./profile/profileTabs";

type ProfileScreenProps = {
  tab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
};

export function ProfileScreen({ tab, onTabChange }: ProfileScreenProps) {
  const { t } = useTranslation();
  usePageTitle(t("profile:title"));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("profile:title")}</h1>

      <Tabs value={tab} onValueChange={(value) => onTabChange(parseProfileTab(value))}>
        <TabsList aria-label={t("profile:tabsLabel")}>
          {PROFILE_TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {t(`profile:tabs.${name}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="story">
          <StoryTab />
        </TabsContent>
        <TabsContent value="answers">
          <FormAnswersForm saveLabel={t("common:actions.save")} />
        </TabsContent>
        <TabsContent value="targets">
          <TargetsForm saveLabel={t("common:actions.save")} />
        </TabsContent>
        <TabsContent value="banned">
          <BannedWordsForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
