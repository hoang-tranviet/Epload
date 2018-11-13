#!/usr/bin/perl

use strict;
use warnings;
use Time::HiRes  qw(usleep nanosleep);

my $timeout = $ARGV[0] + 0;

usleep(1000 * $timeout);
