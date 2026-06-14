import { useState, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Trash2, Eye, Calendar, Search, X, Tag, Edit, Share2, Copy, Check, Download, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { TestComparisonDialog } from "./TestComparisonDialog";
import { QRCodeSVG } from "qrcode.react";
import { createLogger } from '@/lib/logger';
const log = createLogger('SavedComparisonsTab');

interface SavedComparisonsTabProps {
  credentialId: number;
}

export function SavedComparisonsTab({ credentialId }: SavedComparisonsTabProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedComparisonId, setSelectedComparisonId] = useState<number | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewExecutionId1, setViewExecutionId1] = useState<number | undefined>();
  const [viewExecutionId2, setViewExecutionId2] = useState<number | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [editTagsDialogOpen, setEditTagsDialogOpen] = useState(false);
  const [editingComparisonId, setEditingComparisonId] = useState<number | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  const [currentComparison, setCurrentComparison] = useState<any>(null);
  const qrCodeRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();

  // Get saved comparisons
  const { data: savedComparisons, isLoading } = trpc.testingCertification.getSavedComparisons.useQuery(
    { credentialId },
    { enabled: !!credentialId }
  );

  // Delete mutation
  const deleteMutation = trpc.testingCertification.deleteComparison.useMutation({
    onSuccess: () => {
      toast.success("Comparison deleted successfully");
      utils.testingCertification.getSavedComparisons.invalidate();
      setDeleteDialogOpen(false);
      setSelectedComparisonId(null);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete comparison");
    },
  });

  // Generate share link mutation
  const generateShareMutation = trpc.testingCertification.generateShareLink.useMutation({
    onSuccess: (data) => {
      setShareUrl(data.shareUrl);
      setShareDialogOpen(true);
      toast.success("Share link generated successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to generate share link");
    },
  });

  // Update tags mutation
  const updateTagsMutation = trpc.testingCertification.updateComparisonTags.useMutation({
    onSuccess: () => {
      toast.success("Tags updated successfully");
      setEditTagsDialogOpen(false);
      setEditingComparisonId(null);
      setEditTags([]);
      setTagInput("");
      utils.testingCertification.getSavedComparisons.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update tags");
    },
  });

  const handleDelete = (id: number) => {
    setSelectedComparisonId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (selectedComparisonId) {
      deleteMutation.mutate({
        id: selectedComparisonId,
        credentialId,
      });
    }
  };

  const handleShare = (comparisonId: number) => {
    const comparison = savedComparisons?.find(c => c.id === comparisonId);
    setCurrentComparison(comparison || null);
    generateShareMutation.mutate({
      id: comparisonId,
      credentialId,
    });
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Link copied to clipboard");
  };

  const convertQRCodeToCanvas = async (): Promise<HTMLCanvasElement | null> => {
    try {
      if (!qrCodeRef.current) return null;

      // Get the SVG element
      const svgElement = qrCodeRef.current.querySelector('svg');
      if (!svgElement) return null;

      // Create a canvas element
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      // Set canvas size (including padding)
      const size = 240; // 200 + padding
      canvas.width = size;
      canvas.height = size;

      // Fill white background
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, size, size);

      // Convert SVG to data URL
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          // Draw image on canvas with padding
          const padding = 20;
          ctx.drawImage(img, padding, padding, size - padding * 2, size - padding * 2);
          URL.revokeObjectURL(url);
          resolve(canvas);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      });
    } catch (err) {
      log.error('Failed to convert QR code:', err);
      return null;
    }
  };

  const handleCopyQRCode = async () => {
    try {
      const canvas = await convertQRCodeToCanvas();
      if (!canvas) {
        toast.error("Failed to copy QR code");
        return;
      }

      canvas.toBlob(async (blob) => {
        if (!blob) return;
        
        try {
          // Copy to clipboard
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          
          setQrCopied(true);
          setTimeout(() => setQrCopied(false), 2000);
          toast.success("QR code copied to clipboard");
        } catch (err) {
          log.error('Failed to copy QR code:', err);
          toast.error("Failed to copy QR code");
        }
      }, 'image/png');
    } catch (err) {
      log.error('Failed to copy QR code:', err);
      toast.error("Failed to copy QR code");
    }
  };

  const handleDownloadQRCode = async () => {
    try {
      const canvas = await convertQRCodeToCanvas();
      if (!canvas) {
        toast.error("Failed to download QR code");
        return;
      }

      canvas.toBlob((blob) => {
        if (!blob) return;
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `comparison-qr-code-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        toast.success("QR code downloaded successfully");
      }, 'image/png');
    } catch (err) {
      log.error('Failed to download QR code:', err);
      toast.error("Failed to download QR code");
    }
  };

  const handleView = (executionId1: number, executionId2: number) => {
    setViewExecutionId1(executionId1);
    setViewExecutionId2(executionId2);
    setViewDialogOpen(true);
  };

  const handleEditTags = (comparisonId: number, currentTags: string[]) => {
    setEditingComparisonId(comparisonId);
    setEditTags(currentTags || []);
    setEditTagsDialogOpen(true);
  };

  const handleSaveTags = () => {
    if (editingComparisonId === null) return;
    updateTagsMutation.mutate({
      id: editingComparisonId,
      credentialId,
      tags: editTags,
    });
  };

  // Get all unique tags
  const allTags = useMemo(() => {
    if (!savedComparisons) return [];
    const tags = new Set<string>();
    savedComparisons.forEach((c) => {
      if (c.tags && Array.isArray(c.tags)) {
        c.tags.forEach((tag: string) => tags.add(tag));
      }
    });
    return Array.from(tags).sort();
  }, [savedComparisons]);

  // Filter comparisons based on search query and selected tag
  const filteredComparisons = useMemo(() => {
    if (!savedComparisons) return [];
    
    let filtered = savedComparisons;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (comparison) =>
          comparison.name.toLowerCase().includes(query) ||
          (comparison.notes && comparison.notes.toLowerCase().includes(query))
      );
    }

    // Filter by selected tag
    if (selectedTag) {
      filtered = filtered.filter(
        (comparison) =>
          comparison.tags &&
          Array.isArray(comparison.tags) &&
          comparison.tags.includes(selectedTag)
      );
    }

    return filtered;
  }, [savedComparisons, searchQuery, selectedTag]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasComparisons = savedComparisons && savedComparisons.length > 0;
  const hasFilteredResults = filteredComparisons.length > 0;

  return (
    <>
      {/* Search and Filter Bar */}
      {hasComparisons && (
        <div className="space-y-3 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name or notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {allTags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Filter by tag:</span>
              <Button
                variant={selectedTag === null ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedTag(null)}
              >
                All
              </Button>
              {allTags.map((tag) => (
                <Button
                  key={tag}
                  variant={selectedTag === tag ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedTag(tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* No Comparisons Message */}
      {!hasComparisons && (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-2">No saved comparisons yet</p>
          <p className="text-sm text-muted-foreground">
            Save comparisons from the comparison dialog to view them here
          </p>
        </div>
      )}

      {/* No Search Results Message */}
      {hasComparisons && !hasFilteredResults && (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-2">No comparisons found</p>
          <p className="text-sm text-muted-foreground">
            Try adjusting your search query
          </p>
        </div>
      )}

      {/* Comparisons List */}
      {hasFilteredResults && (
        <div className="grid gap-4">
          {filteredComparisons.map((comparison) => (
          <Card key={comparison.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg">{comparison.name}</CardTitle>
                  <CardDescription className="mt-1 flex items-center gap-2">
                    <Calendar className="h-3 w-3" />
                    {new Date(comparison.createdAt).toLocaleString()}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleView(comparison.executionId1 ?? 0, comparison.executionId2 ?? 0)}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    View
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleShare(comparison.id)}
                    disabled={generateShareMutation.isPending}
                  >
                    <Share2 className="h-4 w-4 mr-1" />
                    Share
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(comparison.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {comparison.notes && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap mb-3">
                  {comparison.notes}
                </p>
              )}
              {comparison.scanCount !== undefined && comparison.scanCount > 0 && (
                <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
                  <BarChart3 className="h-3 w-3" />
                  <span>
                    {comparison.scanCount} scan{comparison.scanCount !== 1 ? 's' : ''}
                    {comparison.lastScannedAt && (
                      <span className="ml-1">
                        · Last: {new Date(comparison.lastScannedAt).toLocaleDateString()}
                      </span>
                    )}
                  </span>
                </div>
              )}
              {comparison.tags && Array.isArray(comparison.tags) && comparison.tags.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag className="h-3 w-3 text-muted-foreground" />
                  {comparison.tags.map((tag: string, index: number) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2 py-1 bg-primary/10 text-primary rounded-md text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEditTags(comparison.id, comparison.tags as string[])}
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                </div>
              )}
              {(!comparison.tags || !Array.isArray(comparison.tags) || comparison.tags.length === 0) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEditTags(comparison.id, [])}
                >
                  <Tag className="h-3 w-3 mr-1" />
                  Add Tags
                </Button>
              )}
            </CardContent>
          </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Saved Comparison?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the saved comparison.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View Comparison Dialog */}
      {viewExecutionId1 && viewExecutionId2 && (
        <TestComparisonDialog
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
          credentialId={credentialId}
          initialExecutionId={viewExecutionId1}
        />
      )}

      {/* Edit Tags Dialog */}
      <Dialog open={editTagsDialogOpen} onOpenChange={setEditTagsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Tags</DialogTitle>
            <DialogDescription>
              Add or remove tags for this comparison
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="tag-input">Add Tag</Label>
              <div className="flex gap-2">
                <Input
                  id="tag-input"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && tagInput.trim()) {
                      e.preventDefault();
                      if (!editTags.includes(tagInput.trim())) {
                        setEditTags([...editTags, tagInput.trim()]);
                      }
                      setTagInput("");
                    }
                  }}
                  placeholder="Type a tag and press Enter"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (tagInput.trim() && !editTags.includes(tagInput.trim())) {
                      setEditTags([...editTags, tagInput.trim()]);
                      setTagInput("");
                    }
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
            {editTags.length > 0 && (
              <div>
                <Label>Current Tags</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {editTags.map((tag, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-md text-sm"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => setEditTags(editTags.filter((_, i) => i !== index))}
                        className="hover:text-primary/70"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTagsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTags} disabled={updateTagsMutation.isPending}>
              {updateTagsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Tags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Link Dialog */}
      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Comparison</DialogTitle>
            <DialogDescription>
              Anyone with this link can view this comparison without logging in
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="share-url">Share URL</Label>
              <div className="flex gap-2 mt-2">
                <Input
                  id="share-url"
                  value={shareUrl}
                  readOnly
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyLink}
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                This link will remain active until you revoke it
              </p>
            </div>
            
            {/* Scan Statistics */}
            {currentComparison && currentComparison.scanCount !== undefined && currentComparison.scanCount > 0 && (
              <div className="flex items-center justify-center gap-2 pt-3 pb-2 border-t">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Scanned <span className="font-semibold text-foreground">{currentComparison.scanCount}</span> time{currentComparison.scanCount !== 1 ? 's' : ''}
                  {currentComparison.lastScannedAt && (
                    <span className="ml-1">
                      · Last: {new Date(currentComparison.lastScannedAt).toLocaleDateString()}
                    </span>
                  )}
                </span>
              </div>
            )}
            
            {/* QR Code Section */}
            <div className="flex flex-col items-center gap-3 pt-4 border-t">
              <Label>Scan QR Code</Label>
              <div ref={qrCodeRef} className="p-4 bg-white rounded-lg border-2 border-gray-200">
                <QRCodeSVG
                  value={shareUrl}
                  size={200}
                  level="H"
                  includeMargin={true}
                />
              </div>
              <div className="flex gap-2 w-full max-w-xs">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyQRCode}
                  className="flex-1"
                >
                  {qrCopied ? (
                    <>
                      <Check className="h-4 w-4 mr-2 text-green-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadQRCode}
                  className="flex-1"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
              <p className="text-xs text-center text-muted-foreground max-w-xs">
                Scan this QR code with your mobile device to quickly access the shared comparison
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
