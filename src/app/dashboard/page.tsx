import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, FolderPlus } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top Bar */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-4">
        <span className="text-base font-semibold tracking-tight text-foreground">
          DevStash
        </span>

        <div className="relative mx-auto w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search items..."
            className="pl-8"
            readOnly
          />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <FolderPlus />
            New Collection
          </Button>
          <Button size="sm">
            <Plus />
            New Item
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">Sidebar</h2>
        </aside>

        {/* Main */}
        <main className="flex flex-1 flex-col overflow-auto p-6">
          <h2 className="text-sm font-semibold text-foreground">Main</h2>
        </main>
      </div>
    </div>
  );
}
