import { useState } from "react";
import { ArticleSources } from "../components/ArticleSources";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { ProvidersSection } from "./settings/ProvidersSection";
import { LLMConfigSection } from "./settings/LLMConfigSection";
import { ImageModelSection } from "./settings/ImageModelSection";
import { VideoModelSection } from "./settings/VideoModelSection";
import { IntegrationsSection } from "./settings/IntegrationsSection";
import { GlobalSettingsSection } from "./settings/GlobalSettingsSection";

type TabKey = "providers" | "llm" | "image" | "video" | "sources" | "integrations" | "global";

const TABS: { key: TabKey; label: string }[] = [
  { key: "providers", label: "Providers & Keys" },
  { key: "llm", label: "LLM Functions" },
  { key: "image", label: "Image Models" },
  { key: "video", label: "Video Models" },
  { key: "sources", label: "Article Sources" },
  { key: "integrations", label: "Integrations" },
  { key: "global", label: "Global" },
];

export default function SystemSettings() {
  const [tab, setTab] = useState<TabKey>("providers");
  return (
    <div>
      <PageHeader title="System Settings" />
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="providers" className="mt-5"><ProvidersSection /></TabsContent>
        <TabsContent value="llm" className="mt-5"><LLMConfigSection /></TabsContent>
        <TabsContent value="image" className="mt-5"><ImageModelSection /></TabsContent>
        <TabsContent value="video" className="mt-5"><VideoModelSection /></TabsContent>
        <TabsContent value="sources" className="mt-5"><ArticleSources /></TabsContent>
        <TabsContent value="integrations" className="mt-5"><IntegrationsSection /></TabsContent>
        <TabsContent value="global" className="mt-5"><GlobalSettingsSection /></TabsContent>
      </Tabs>
    </div>
  );
}
