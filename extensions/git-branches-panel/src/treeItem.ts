import * as path from 'node:path';
import * as vscode from 'vscode';

import { type BranchInfo, type BranchTreeNode, type RemoteConfigInfo, type TreeContainerScope } from './branchModel';
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
  public readonly remoteInfo?: RemoteConfigInfo;
  public readonly containerKey?: string;
  public readonly containerPath?: string;
  public readonly containerScope?: TreeContainerScope;
  public readonly repoRoot?: string;

  constructor(node: BranchTreeNode) {
    const presentation = buildTreeItemPresentation(node);

    super(presentation.label, toTreeItemCollapsibleState(presentation.collapsibleState));

    this.nodeType = presentation.nodeType;
    this.branchName = presentation.branchName;
    this.branchInfo = node.kind === 'branch' ? node.info : undefined;
    this.remoteInfo = node.kind === 'remote' ? node.info : undefined;
    this.containerKey = presentation.containerKey;
    this.containerPath = presentation.containerPath;
    this.containerScope = presentation.containerScope;
    this.repoRoot = node.repoRoot;
    this.id = presentation.id;
    this.contextValue = presentation.contextValue;
    this.description = presentation.description;
    this.tooltip = presentation.tooltip ? new vscode.MarkdownString(presentation.tooltip) : undefined;
    this.iconPath = toIconPath(presentation.icon);

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

function toIconPath(icon: TreeItemIconDescriptor): vscode.ThemeIcon | vscode.Uri {
  if (icon.resourcePath) {
    return vscode.Uri.file(path.join(__dirname, '..', 'resources', icon.resourcePath));
  }

  if (!icon.id) {
    throw new Error('Tree item icon descriptor must define an id or resourcePath.');
  }

  return icon.colorId
    ? new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.colorId))
    : new vscode.ThemeIcon(icon.id);
}
