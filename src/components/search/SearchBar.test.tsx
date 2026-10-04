import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchBar } from "./SearchBar";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

describe("SearchBar — UI pay-per-query", () => {
  const baseProps = {
    onSearch: vi.fn(),
    isSearching: false,
    walletConnected: true,
    usdcBalance: "1.000000",
    walletNetwork: "TESTNET",
    defaultQuery: "",
  };

  it("calls onSearch with query on submit", () => {
    const onSearch = vi.fn();
    render(<SearchBar {...baseProps} onSearch={onSearch} />);
    const input = screen.getByLabelText("Search query") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "stellar x402" } });
    // Submit form
    const form = screen.getByRole("search");
    fireEvent.submit(form);
    expect(onSearch).toHaveBeenCalledWith("stellar x402", [], []);
  });

  it("does not call onSearch when query empty", () => {
    const onSearch = vi.fn();
    render(<SearchBar {...baseProps} onSearch={onSearch} />);
    const form = screen.getByRole("search");
    fireEvent.submit(form);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("disables input when isSearching", () => {
    const { container } = render(
      <SearchBar {...baseProps} isSearching={true} />,
    );
    expect(screen.getByLabelText("Search query")).toBeDisabled();
    // When searching, submit button shows spinner; query via type=submit
    const submitBtn = container.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.disabled).toBe(true);
  });

  it("shows network mismatch when walletNetwork mismatched", () => {
    render(<SearchBar {...baseProps} walletNetwork="PUBLIC" />);
    expect(screen.getByText(/NETWORK MISMATCH/)).toBeInTheDocument();
    expect(screen.getByLabelText("Search query")).toBeDisabled();
    expect(
      screen.getByLabelText("Search query").getAttribute("placeholder"),
    ).toMatch(/Switch network/);
  });


  it("shows queries left calculated from balance", () => {
    render(<SearchBar {...baseProps} usdcBalance="0.005" />);
    // 0.005 / 0.001 = 5 queries
    expect(screen.getByText(/Balance: 0\.005 USDC/)).toBeInTheDocument();
    expect(screen.getByText(/5 queries left/)).toBeInTheDocument();
  });

  it("shows connect wallet prompt when not connected", () => {
    render(<SearchBar {...baseProps} walletConnected={false} />);
    expect(
      screen.getByText("Connect Freighter wallet to search"),
    ).toBeInTheDocument();
  });

  it("displays USDC amount from constants", () => {
    render(<SearchBar {...baseProps} />);
    // Button shows "0.001 USDC"
    expect(screen.getByText(/0\.001 USDC/)).toBeInTheDocument();
  });
});
