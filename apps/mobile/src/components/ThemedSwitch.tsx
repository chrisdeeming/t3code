import { Platform, Switch, type SwitchProps } from "react-native";

import { useThemeColor } from "../lib/useThemeColor";

export function ThemedSwitch(props: SwitchProps) {
  const activeTrack = String(useThemeColor("--color-switch-active"));
  const inactiveTrack = String(useThemeColor("--color-secondary-border"));
  const activeThumb = String(useThemeColor("--color-primary-foreground"));
  const inactiveThumb = String(useThemeColor("--color-foreground-muted"));

  return (
    <Switch
      {...props}
      ios_backgroundColor={inactiveTrack}
      thumbColor={
        Platform.OS === "android" ? (props.value ? activeThumb : inactiveThumb) : undefined
      }
      trackColor={{ false: inactiveTrack, true: activeTrack }}
    />
  );
}
