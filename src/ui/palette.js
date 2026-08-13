// App compatibility boundary for the reusable command-palette primitive.
import { openCommandPalette } from "@hypo/ui/palette";
import { icon } from "./icons.js";

export function openPalette(commands) {
  return openCommandPalette((query) =>
    commands(query).map((command) => ({
      ...command,
      icon: command.iconName ? icon(command.iconName) : null,
    })),
  );
}
