import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "./Button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "./Menu";
import { Popover } from "./Popover";
import { cx } from "./utils";
import "./SettingsNav.css";

export type SettingsNavItem<T extends string> = {
  value: T;
  label: ReactNode;
  count?: number;
  href?: string;
  trailingIcon?: ReactNode;
};

export type SettingsNavGroup<T extends string> = {
  label: ReactNode;
  items: readonly SettingsNavItem<T>[];
};

export function SettingsNav<T extends string>({
  value,
  groups,
  onChange,
  label,
  className,
}: {
  value: T;
  groups: readonly SettingsNavGroup<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const items = groups.flatMap((group) => group.items);
  const activeItem = items.find((item) => item.value === value) ?? items[0];
  const select = (item: SettingsNavItem<T>) => {
    if (item.href) navigate(item.href);
    else onChange(item.value);
    setMobileOpen(false);
  };

  return <nav className={cx("ui-settings-nav", className)} aria-label={label}>
    <div className="ui-settings-nav__desktop">
      {groups.map((group) => <div className="ui-settings-nav__group" key={String(group.label)}>
        <div className="ui-settings-nav__group-label">{group.label}</div>
        <div className="ui-settings-nav__items">
          {group.items.map((item) => {
            const content = <><span>{item.label}</span><span className="ui-settings-nav__item-trailing">{item.count != null && item.count > 0 && <span className="ui-settings-nav__count">{item.count}</span>}{item.trailingIcon}</span></>;
            return item.href ? <Link className={cx("ui-settings-nav__item", item.value === value && "ui-settings-nav__item--active")} to={item.href} key={item.value}>{content}</Link> : <button
              type="button"
              className={cx("ui-settings-nav__item", item.value === value && "ui-settings-nav__item--active")}
              aria-current={item.value === value ? "page" : undefined}
              onClick={() => select(item)}
              key={item.value}
            >{content}</button>;
          })}
        </div>
      </div>)}
    </div>

    <Popover
      rootClassName="ui-settings-nav__mobile"
      className="ui-settings-nav__mobile-popover"
      surface="menu"
      align="start"
      open={mobileOpen}
      onOpenChange={setMobileOpen}
      trigger={<Button className="ui-settings-nav__mobile-trigger" trailingIcon={<ChevronDown />} aria-label={label}>{activeItem?.label}</Button>}
    >
      <Menu>
        {groups.map((group, index) => <div key={String(group.label)}>
          {index > 0 && <MenuSeparator />}
          <MenuLabel>{group.label}</MenuLabel>
          {group.items.map((item) => <MenuItem
            selected={item.value === value}
            suffix={<span className="ui-settings-nav__item-trailing">{item.count != null && item.count > 0 && <span className="ui-settings-nav__count">{item.count}</span>}{item.trailingIcon}</span>}
            onClick={() => select(item)}
            key={item.value}
          >{item.label}</MenuItem>)}
        </div>)}
      </Menu>
    </Popover>
  </nav>;
}
