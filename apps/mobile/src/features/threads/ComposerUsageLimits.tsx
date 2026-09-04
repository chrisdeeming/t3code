import type { EnvironmentId, UsageLimitsReport } from "@t3tools/contracts";
import { providerLimitsLabel } from "@t3tools/shared/usageLimits";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { AccountLimits, ResetCredits } from "../usage/UsageLimitsSection";

const DRIVER_LABEL: Partial<Record<string, string>> = { codex: "Codex", claudeAgent: "Claude" };

/**
 * The /usage-limits result, docked above the composer. It is the Usage → Limits
 * card one size down, so the two read as the same thing. The surface is opaque
 * because nothing blurs the feed behind it.
 */
export function ComposerUsageLimits({
  report,
  environmentId,
  onClose,
}: {
  readonly report: UsageLimitsReport;
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const now = Date.parse(report.createdAt);
  const { height } = useWindowDimensions();
  const close = (
    <Pressable
      accessibilityLabel="Dismiss usage limits"
      accessibilityRole="button"
      hitSlop={12}
      onPress={onClose}
      className="-me-1 p-1 active:opacity-60"
    >
      <SymbolView name="xmark" size={14} tintColorClassName="accent-icon-muted" type="monochrome" />
    </Pressable>
  );
  return (
    <View className="overflow-hidden rounded-[20px] border-continuous bg-card">
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: Math.round(height * 0.4) }}
      >
        {report.accounts.map((account, index) => {
          const driverLabel = DRIVER_LABEL[account.driver] ?? String(account.driver);
          return (
            <AccountLimits
              key={account.id}
              dense
              first={index === 0}
              label={driverLabel}
              instanceLabel={
                account.instanceId
                  ? providerLimitsLabel(account, (driver) => DRIVER_LABEL[driver])
                  : (account.sourceLabel ?? account.label)
              }
              detail={account.plan}
              limits={account.limits}
              now={now}
              trailing={index === 0 ? close : undefined}
              footer={
                account.instanceId && account.limits.resetCredits ? (
                  <ResetCredits
                    dense
                    environmentId={environmentId}
                    instanceId={account.instanceId}
                    credits={account.limits.resetCredits}
                    now={now}
                  />
                ) : undefined
              }
            />
          );
        })}
        {report.notices.map((notice) => (
          <Text
            key={notice}
            className="border-t border-border-subtle px-4 py-3 text-xs text-foreground-muted"
          >
            {notice}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}
