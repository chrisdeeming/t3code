#pragma once

#import <UIKit/UIKit.h>

// Used by both the shadow measurement and UITextView rendering paths.
static NSDictionary *T3ContextChipPayload(NSString *uri)
{
  if (![uri hasPrefix:@"chip:"]) return nil;
  NSData *data = [[uri substringFromIndex:5] dataUsingEncoding:NSUTF8StringEncoding];
  id payload = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [payload isKindOfClass:NSDictionary.class] ? payload : nil;
}

static UIColor *T3ContextChipColor(NSString *hex)
{
  unsigned int rgb = 0;
  if (![hex isKindOfClass:NSString.class] || hex.length != 7) return UIColor.labelColor;
  [[NSScanner scannerWithString:[hex substringFromIndex:1]] scanHexInt:&rgb];
  return [UIColor colorWithRed:((rgb >> 16) & 255) / 255.0
                        green:((rgb >> 8) & 255) / 255.0
                         blue:(rgb & 255) / 255.0 alpha:1];
}

static UIColor *T3ContextChipBlend(UIColor *accent, UIColor *base, CGFloat weight)
{
  CGFloat ar = 0, ag = 0, ab = 0, aa = 0, br = 0, bg = 0, bb = 0, ba = 0;
  [accent getRed:&ar green:&ag blue:&ab alpha:&aa];
  [base getRed:&br green:&bg blue:&bb alpha:&ba];
  return [UIColor colorWithRed:ar * weight + br * (1 - weight)
                        green:ag * weight + bg * (1 - weight)
                         blue:ab * weight + bb * (1 - weight)
                        alpha:aa * weight + ba * (1 - weight)];
}

static UIFont *T3ContextChipFont(NSDictionary *payload)
{
  CGFloat size = MAX(10, MIN(40, [payload[@"fontSize"] doubleValue]));
  return [UIFont fontWithName:@"DMSans-Medium" size:size]
    ?: [UIFont systemFontOfSize:size weight:UIFontWeightMedium];
}

static inline CGSize T3ContextChipSize(NSDictionary *payload, CGFloat maximumWidth)
{
  UIFont *font = T3ContextChipFont(payload);
  NSString *label = payload[@"label"];
  CGFloat textWidth = [label sizeWithAttributes:@{ NSFontAttributeName: font }].width;
  return CGSizeMake(MIN(maximumWidth, ceil(textWidth + font.pointSize * 2.5)),
                    ceil(font.pointSize * 1.41));
}

static inline UIImage *T3ContextChipImage(NSDictionary *payload, CGSize size, UIImage *fileIcon)
{
  static NSCache<NSString *, UIImage *> *cache;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ cache = [NSCache new]; cache.countLimit = 256; });
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:NSJSONWritingSortedKeys error:nil];
  NSString *key = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  key = [key stringByAppendingString:NSStringFromCGSize(size)];
  if (fileIcon != nil) key = [key stringByAppendingString:@":file-icon"];
  UIImage *cached = [cache objectForKey:key];
  if (cached) return cached;
  UIFont *font = T3ContextChipFont(payload);
  CGFloat em = font.pointSize;
  UIColor *accent = T3ContextChipColor(payload[@"accent"]);
  UIColor *foreground = T3ContextChipBlend(accent, T3ContextChipColor(payload[@"foreground"]), 0.22);
  UIColor *border = T3ContextChipBlend(accent, T3ContextChipColor(payload[@"border"]), 0.34);
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:size];
  UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    UIBezierPath *path = [UIBezierPath bezierPathWithRoundedRect:
        CGRectInset(CGRectMake(0, 0, size.width, size.height), 0.5, 0.5)
        cornerRadius:em * 0.5];
    [[accent colorWithAlphaComponent:0.11] setFill];
    [path fill];
    [border setStroke];
    path.lineWidth = 1;
    [path stroke];
    CGFloat iconSize = em * 1.17;
    UIImage *icon = fileIcon ?: [[UIImage systemImageNamed:payload[@"symbol"]
        withConfiguration:[UIImageSymbolConfiguration configurationWithPointSize:em weight:UIImageSymbolWeightMedium]]
        imageWithTintColor:foreground renderingMode:UIImageRenderingModeAlwaysOriginal];
    [icon drawInRect:CGRectMake(em * 0.5, (size.height - iconSize) / 2, iconSize, iconSize)];
    NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
    paragraph.lineBreakMode = NSLineBreakByTruncatingMiddle;
    CGFloat x = em * 2;
    [payload[@"label"] drawInRect:CGRectMake(x, (size.height - font.lineHeight) / 2,
                                           MAX(0, size.width - x - em * 0.5), font.lineHeight)
        withAttributes:@{ NSFontAttributeName: font, NSForegroundColorAttributeName: foreground,
                          NSParagraphStyleAttributeName: paragraph }];
  }];
  [cache setObject:image forKey:key];
  return image;
}
