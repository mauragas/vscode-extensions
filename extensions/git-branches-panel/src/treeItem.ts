import * as vscode from 'vscode';

import { type BranchInfo, type BranchTreeNode, type TreeContainerScope } from './branchModel';
import {
  buildTreeItemPresentation,
  type NodeType,
  type TreeItemCollapsibleKind,
  type TreeItemIconDescriptor,
} from './treePresentation';

export { type NodeType } from './treePresentation';

export class BranchTreeItem extends vscode.TreeItem {
  public readonly nodeType: NodeType;
  public readonly branchName?: string;
  public readonly branchInfo?: BranchInfo;
  public readonly containerKey?: string;
  public readonly containerPath?: string;
  public readonly containerScope?: TreeContainerScope;
  public readonly repoRoot?: string;

  constructor(node: BranchTreeNode, repoRoot?: string) {
    const presentation = buildTreeItemPresentation(node);

    super(presentation.label, toTreeItemCollapsibleState(presentation.collapsibleState));

    this.nodeType = presentation.nodeType;
    this.branchName = presentation.branchName;
    this.branchInfo = node.kind === 'branch' ? node.info : undefined;
    this.containerKey = presentation.containerKey;
    this.containerPath = presentation.containerPath;
    this.containerScope = presentation.containerScope;
    this.repoRoot = repoRoot;
    this.id = presentation.id;
    this.contextValue = presentation.contextValue;
    this.description = presentation.description;
    this.tooltip = presentation.tooltip ? new vscode.MarkdownString(presentation.tooltip) : undefined;
    this.iconPath = toThemeIcon(presentation.icon);

    if (presentation.command) {
      this.command = {
        ...presentation.command,
        arguments: [this],
      };
    }
  }
}

function toTreeItemCollapsibleState(
  collapsibleState: TreeItemCollapsibleKind
): vscode.TreeItemCollapsibleState {
  switch (collapsibleState) {
    case 'expanded':
      return vscode.TreeItemCollapsibleState.Expanded;
    case 'collapsed':
      return vscode.TreeItemCollapsibleState.Collapsed;
    default:
      return vscode.TreeItemCollapsibleState.None;
  }
}

function toThemeIcon(icon: TreeItemIconDescriptor): vscode.ThemeIcon {
  return icon.colorId
    ? new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.colorId))
    : new vscode.ThemeIcon(icon.id);
}
